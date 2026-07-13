// Chat 路由 —— 对应 Python app/api/v1/chat.py
// 含会话 CRUD、消息游标分页、对话补全（流式 SSE + 非流式）、反馈、重新生成
import { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'
import { authGuard } from '../plugins/auth.js'
import { NotFoundError, ForbiddenError, BadGatewayError, TooManyRequestsError } from '../plugins/error-handler.js'
import { genId } from '../utils/id.js'
import { env } from '../config/env.js'
import { llmService } from '../core/llm.js'
import {
  CreateSessionRequestSchema,
  UpdateSessionRequestSchema,
  ChatCompletionRequestSchema,
  StopGenerationRequestSchema,
  FeedbackRequestSchema,
  EditMessageRequestSchema,
  RegenerateRequestSchema,
} from '../schemas/chat.js'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { buildSchema } from '../utils/zod-schema.js'

type Message = { role: string; content: string }

// P0-1 修复：运行中的生成任务注册表
// key: runId, value: { abortController, sessionId, userId }
// /stop 端点通过 sessionId 查找并 abort，联动中止上游 LLM 请求
interface RunningRun {
  abortController: AbortController
  sessionId: string
  userId: string
}
const runningRuns = new Map<string, RunningRun>()

/** 按 sessionId 查找正在运行的生成任务（用于停止生成） */
function findRunBySession(sessionId: string, userId: string): RunningRun | undefined {
  for (const run of runningRuns.values()) {
    if (run.sessionId === sessionId && run.userId === userId) {
      return run
    }
  }
  return undefined
}

export const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.register(
    async (app) => {
      app.addHook('preHandler', authGuard)

      // 对应 Python: _verify_session_owner
      async function verifySessionOwner(sessionId: string, userId: string) {
        const session = await fastify.prisma.chatSession.findFirst({
          where: { id: sessionId, userId },
        })
        if (!session) {
          throw new NotFoundError('会话不存在')
        }
        return session
      }

      /** P0-4 修复：回滚已写入的用户消息（LLM 调用失败或空回复时调用）
       * 删除 userMsg 并回滚 messageCount，避免孤儿用户消息
       */
      async function rollbackUserMessage(sessionId: string, userMsgId: string) {
        await Promise.all([
          fastify.prisma.chatMessage.delete({ where: { id: userMsgId } }).catch(() => {}),
          fastify.prisma.chatSession.update({
            where: { id: sessionId },
            data: { messageCount: { decrement: 1 } },
          }).catch(() => {}),
        ])
      }

      // ========== 会话 ==========

      // 对应 Python: @router.get("/sessions")
      // P0 修复：改为游标分页，避免偏移分页在 updatedAt 变化时跨页重复/跳过
      // 排序键为 (updatedAt desc, id desc)，id 作为 tie-breaker 保证顺序稳定
      app.get('/sessions', buildSchema({
        querystring: z.object({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
          archived: z.string().optional(),
        }),
        tags: ['chat'],
        summary: '会话列表（游标分页）',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const query = req.query as {
          cursor?: string
          limit?: string
          archived?: string
        }
        const limit = Math.min(100, Math.max(1, parseInt(query.limit || '50') || 50))
        const archived = query.archived === 'true' ? true : query.archived === 'false' ? false : undefined

        // 基础过滤条件（用于 count 与 findMany）
        const baseWhere: Record<string, unknown> = { userId: req.user.id }
        if (archived !== undefined) {
          baseWhere.isArchived = archived
        }

        // 游标分页：以 (updatedAt, id) 复合元组为稳定排序键
        // 注意：游标条件仅用于 findMany，不能加入 count 的 where
        // 否则 total 会随翻页递减（P0-3 修复）
        const findWhere: Record<string, unknown> = { ...baseWhere }
        if (query.cursor) {
          const cursorSession = await fastify.prisma.chatSession.findUnique({
            where: { id: query.cursor },
          })
          if (cursorSession) {
            findWhere.OR = [
              { updatedAt: { lt: cursorSession.updatedAt } },
              { updatedAt: cursorSession.updatedAt, id: { lt: cursorSession.id } },
            ]
          }
        }

        // count 用 baseWhere（绝对总数，不随游标变化），findMany 用 findWhere
        const [total, sessions] = await Promise.all([
          fastify.prisma.chatSession.count({ where: baseWhere }),
          fastify.prisma.chatSession.findMany({
            where: findWhere,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: limit + 1, // 多取一条判断 hasMore
          }),
        ])

        const hasMore = sessions.length > limit
        const result = hasMore ? sessions.slice(0, limit) : sessions
        const nextCursor = result.length > 0 ? result[result.length - 1].id : null

        // 对应 Python: 逐 session 查询最后一条消息
        const sessionList = await Promise.all(
          result.map(async (s) => {
            const lastMsg = await fastify.prisma.chatMessage.findFirst({
              where: { sessionId: s.id },
              orderBy: { createdAt: 'desc' },
            })

            return {
              id: s.id,
              title: s.title,
              model: s.model,
              modelConfig: s.modelConfig,
              messageCount: s.messageCount ?? 0,
              lastMessage: lastMsg
                ? {
                    content: lastMsg.content?.slice(0, 150) ?? null,
                    role: lastMsg.role,
                    createdAt: lastMsg.createdAt.toISOString(),
                  }
                : null,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
              isArchived: s.isArchived ?? false,
            }
          }),
        )

        return { sessions: sessionList, total, limit, nextCursor, hasMore }
      })

      // 对应 Python: @router.post("/sessions")
      app.post('/sessions', buildSchema({
        body: CreateSessionRequestSchema,
        tags: ['chat'],
        summary: '创建会话',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const dto = CreateSessionRequestSchema.parse(req.body)

        const session = await fastify.prisma.chatSession.create({
          data: {
            id: genId('sess_'),
            userId: req.user.id,
            title: dto.title || '新对话',
            model: dto.model || env.LLM_DEFAULT_MODEL,
            systemPrompt: dto.systemPrompt ?? null,
          },
        })

        return {
          id: session.id,
          title: session.title,
          model: session.model,
          modelConfig: session.modelConfig,
          messageCount: session.messageCount ?? 0,
          lastMessage: null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          isArchived: session.isArchived ?? false,
        }
      })

      // 对应 Python: @router.get("/sessions/{sessionId}")
      app.get('/sessions/:sessionId', buildSchema({
        params: z.object({ sessionId: z.string() }),
        tags: ['chat'],
        summary: '获取会话详情',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { sessionId } = req.params as { sessionId: string }
        const session = await verifySessionOwner(sessionId, req.user.id)

        // P1-7 修复：详情接口返回真实 lastMessage 预览，与列表接口一致
        const lastMsg = await fastify.prisma.chatMessage.findFirst({
          where: { sessionId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })

        return {
          id: session.id,
          title: session.title,
          model: session.model,
          modelConfig: session.modelConfig,
          messageCount: session.messageCount ?? 0,
          lastMessage: lastMsg
            ? {
                content: lastMsg.content?.slice(0, 150) ?? null,
                role: lastMsg.role,
                createdAt: lastMsg.createdAt.toISOString(),
              }
            : null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          isArchived: session.isArchived ?? false,
        }
      })

      // 对应 Python: @router.put("/sessions/{sessionId}")
      app.put('/sessions/:sessionId', buildSchema({
        params: z.object({ sessionId: z.string() }),
        body: UpdateSessionRequestSchema,
        tags: ['chat'],
        summary: '更新会话',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { sessionId } = req.params as { sessionId: string }
        const dto = UpdateSessionRequestSchema.parse(req.body)
        const session = await verifySessionOwner(sessionId, req.user.id)

        const data: Record<string, unknown> = {}
        if (dto.title != null) data.title = dto.title
        if (dto.model != null) data.model = dto.model
        if (dto.modelConfig != null) data.modelConfig = dto.modelConfig
        if (dto.isArchived !== undefined) data.isArchived = dto.isArchived

        const updated = await fastify.prisma.chatSession.update({
          where: { id: sessionId },
          data,
        })

        // P1-7 修复：PUT 响应同样返回真实 lastMessage，与列表/详情一致
        const updatedLastMsg = await fastify.prisma.chatMessage.findFirst({
          where: { sessionId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })

        return {
          id: updated.id,
          title: updated.title,
          model: updated.model,
          modelConfig: updated.modelConfig,
          messageCount: updated.messageCount ?? 0,
          lastMessage: updatedLastMsg
            ? {
                content: updatedLastMsg.content?.slice(0, 150) ?? null,
                role: updatedLastMsg.role,
                createdAt: updatedLastMsg.createdAt.toISOString(),
              }
            : null,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          isArchived: updated.isArchived ?? false,
        }
      })

      // 对应 Python: @router.delete("/sessions/{sessionId}")
      app.delete('/sessions/:sessionId', buildSchema({
        params: z.object({ sessionId: z.string() }),
        // 注意：URL query 参数始终为字符串，z.boolean() 会被 AJV 拦截为 400，故用 z.string()
        querystring: z.object({ archive: z.string().optional() }),
        tags: ['chat'],
        summary: '删除/归档会话',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { sessionId } = req.params as { sessionId: string }
        const query = req.query as { archive?: string }
        const archive = query.archive === 'false' ? false : true

        const session = await verifySessionOwner(sessionId, req.user.id)

        if (archive) {
          // 归档
          await fastify.prisma.chatSession.update({
            where: { id: sessionId },
            data: { isArchived: true },
          })
          return { message: '会话已归档' }
        } else {
          // P1-4 修复：彻底删除改为事务，避免消息删除成功后会话删除失败产生孤儿消息
          await fastify.prisma.$transaction([
            fastify.prisma.chatMessage.deleteMany({
              where: { sessionId },
            }),
            fastify.prisma.chatSession.delete({
              where: { id: sessionId },
            }),
          ])
          return { message: '会话已删除' }
        }
      })

      // ========== 消息 ==========

      // 对应 Python: @router.get("/sessions/{sessionId}/messages")
      app.get('/sessions/:sessionId/messages', buildSchema({
        params: z.object({ sessionId: z.string() }),
        querystring: z.object({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
          direction: z.string().optional(),
        }),
        tags: ['chat'],
        summary: '消息列表（游标分页）',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { sessionId } = req.params as { sessionId: string }
        const query = req.query as {
          cursor?: string
          limit?: string
          direction?: string
        }
        const limit = Math.min(100, Math.max(1, parseInt(query.limit || '30') || 30))
        const direction = query.direction || 'before'

        await verifySessionOwner(sessionId, req.user.id)

        // P1-5 修复：游标分页加 (createdAt, id) 复合 tie-breaker，对齐会话列表做法
        // 避免同毫秒消息在翻页时被跳过或重复
        const where: Record<string, unknown> = { sessionId }
        if (query.cursor) {
          const cursorMsg = await fastify.prisma.chatMessage.findUnique({
            where: { id: query.cursor },
          })
          if (cursorMsg) {
            if (direction === 'before') {
              // 早于游标：createdAt 更小，或 createdAt 相同但 id 更小
              where.OR = [
                { createdAt: { lt: cursorMsg.createdAt } },
                { createdAt: cursorMsg.createdAt, id: { lt: cursorMsg.id } },
              ]
            } else {
              // 晚于游标：createdAt 更大，或 createdAt 相同但 id 更大
              where.OR = [
                { createdAt: { gt: cursorMsg.createdAt } },
                { createdAt: cursorMsg.createdAt, id: { gt: cursorMsg.id } },
              ]
            }
          }
        }

        const messages = await fastify.prisma.chatMessage.findMany({
          where,
          // 复合排序：createdAt 为主键，id 为 tie-breaker
          orderBy: [
            { createdAt: direction === 'before' ? 'desc' : 'asc' },
            { id: direction === 'before' ? 'desc' : 'asc' },
          ],
          take: limit + 1, // 多取一条判断 hasMore
        })

        const hasMore = messages.length > limit
        const result = hasMore ? messages.slice(0, limit) : messages

        // before 模式需要反转顺序（对齐 Python: messages = list(reversed(messages))）
        if (direction === 'before') {
          result.reverse()
        }

        const nextCursor = result.length > 0 && hasMore ? result[result.length - 1].id : null

        return {
          messages: result.map((m) => ({
            id: m.id,
            sessionId: m.sessionId,
            role: m.role,
            content: m.content,
            contentBlocks: m.contentBlocks,
            tokenCount: m.tokenCount,
            feedback: m.feedback ?? 'none',
            metadata: m.extraMetadata,
            parentMessageId: m.parentMessageId,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
          })),
          nextCursor,
          hasMore,
        }
      })

      // 对应 Python: @router.put("/sessions/{sessionId}/messages/{messageId}")
      app.put('/sessions/:sessionId/messages/:messageId', buildSchema({
        params: z.object({ sessionId: z.string(), messageId: z.string() }),
        body: EditMessageRequestSchema,
        tags: ['chat'],
        summary: '编辑消息',
        security: [{ BearerAuth: [] }],
      }), async (req, reply) => {
        const { sessionId, messageId } = req.params as { sessionId: string; messageId: string }
        const dto = EditMessageRequestSchema.parse(req.body)

        await verifySessionOwner(sessionId, req.user.id)

        const msg = await fastify.prisma.chatMessage.findFirst({
          where: { id: messageId, sessionId, userId: req.user.id },
        })
        if (!msg) {
          throw new NotFoundError('消息不存在')
        }
        // 对应 Python: if msg.role != MessageRole.user
        if (msg.role !== 'user') {
          throw new ForbiddenError('仅允许编辑用户消息')
        }

        const updated = await fastify.prisma.chatMessage.update({
          where: { id: messageId },
          data: { content: dto.content },
        })

        if (dto.regenerate) {
          return await doRegenerate(req.user.id, messageId, sessionId, {})
        }

        return {
          id: updated.id,
          sessionId: updated.sessionId,
          role: updated.role,
          content: updated.content,
          contentBlocks: updated.contentBlocks,
          tokenCount: updated.tokenCount,
          feedback: updated.feedback ?? 'none',
          metadata: updated.extraMetadata,
          parentMessageId: updated.parentMessageId,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        }
      })

      // ========== 对话补全 ==========

      // P0-5 修复：配额校验辅助函数
      // 调用前校验 total/used 与 daily 限额；超限抛 429
      async function checkQuota(userId: string): Promise<void> {
        const quota = await fastify.prisma.userQuota.findUnique({
          where: { userId },
        })
        if (!quota) return // 无配额记录视为不限制（兼容旧数据）
        const totalUsed = Number(quota.usedTokens)
        const totalLimit = Number(quota.totalTokens)
        const dailyUsed = Number(quota.dailyUsed)
        const dailyLimit = Number(quota.dailyLimit)
        if (totalLimit > 0 && totalUsed >= totalLimit) {
          throw new TooManyRequestsError(`总 Token 配额已用尽（已用 ${totalUsed}/${totalLimit}）`)
        }
        if (dailyLimit > 0 && dailyUsed >= dailyLimit) {
          throw new TooManyRequestsError(`今日 Token 配额已用尽（已用 ${dailyUsed}/${dailyLimit}）`)
        }
      }

      /** P0-5 修复：记录 Token 用量并扣减配额
       * 优先使用上游真实 usage；缺失时退化为 length/4 估算
       */
      async function recordUsage(
        userId: string,
        sessionId: string,
        messageId: string,
        model: string,
        usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined,
        promptText: string,
        completionText: string,
      ): Promise<void> {
        const promptTokens = usage?.promptTokens ?? Math.floor(promptText.length / 4)
        const completionTokens = usage?.completionTokens ?? Math.floor(completionText.length / 4)
        const totalTokens = usage?.totalTokens ?? (promptTokens + completionTokens)

        await Promise.all([
          fastify.prisma.tokenUsage.create({
            data: {
              userId,
              sessionId,
              messageId,
              model,
              promptTokens,
              completionTokens,
              totalTokens,
            },
          }),
          fastify.prisma.userQuota.update({
            where: { userId },
            data: {
              usedTokens: { increment: BigInt(totalTokens) },
              dailyUsed: { increment: BigInt(totalTokens) },
            },
          }).catch(() => {
            // 配额记录可能不存在（旧用户），忽略更新失败
          }),
        ])
      }

      // 对应 Python: @router.post("/completions")
      app.post('/completions', buildSchema({
        body: ChatCompletionRequestSchema,
        tags: ['chat'],
        summary: '对话补全（流式 SSE / 非流式）',
        security: [{ BearerAuth: [] }],
      }), async (req, reply) => {
        const dto = ChatCompletionRequestSchema.parse(req.body)

        // P0-5 修复：调用 LLM 前校验配额
        await checkQuota(req.user.id)

        let sessionId = dto.sessionId
        if (!sessionId) {
          // 无 session 时自动创建（对齐 Python）
          const session = await fastify.prisma.chatSession.create({
            data: {
              id: genId('sess_'),
              userId: req.user.id,
              title: dto.message.slice(0, 50) || '新对话',
              model: dto.model || env.LLM_DEFAULT_MODEL,
              systemPrompt: dto.systemPrompt ?? null,
            },
          })
          sessionId = session.id
        }

        // 深度思考 → 推理模型
        let model = dto.model || env.LLM_DEFAULT_MODEL
        if (dto.deepThink) {
          model = 'deepseek-reasoner'
        }

        // 写入用户消息
        const userMsg = await fastify.prisma.chatMessage.create({
          data: {
            id: genId('msg_'),
            sessionId,
            userId: req.user.id,
            role: 'user',
            content: dto.message,
            parentMessageId: dto.parentMessageId ?? null,
          },
        })

        // 更新 session message_count
        await fastify.prisma.chatSession.update({
          where: { id: sessionId },
          data: { messageCount: { increment: 1 } },
        })

        // 构建消息上下文（buildMessageContext 已从 DB 读取最近 20 条历史，
        // 含刚写入的 userMsg，无需再 push，避免重复发送用户消息）
        const messages = await buildMessageContext(sessionId, dto.systemPrompt ?? undefined)

        // ===== 非流式 =====
        if (dto.stream === false) {
          let resultData: Record<string, unknown>
          try {
            resultData = await llmService.chatCompletion(
              messages,
              model,
              dto.temperature ?? undefined,
              dto.maxTokens ?? undefined,
            )
          } catch (e) {
            // P0-4 修复：LLM 调用失败时回滚已写入的用户消息，避免孤儿消息
            await rollbackUserMessage(sessionId, userMsg.id)
            throw new BadGatewayError(`LLM API 错误: ${(e as Error).message}`)
          }

          const choices = (resultData as any).choices || [{}]
          const content = choices[0]?.message?.content || ''
          // P0-4 修复：空回复回滚用户消息 + messageCount
          if (!content) {
            await rollbackUserMessage(sessionId, userMsg.id)
            throw new BadGatewayError('LLM 返回空内容，已回滚用户消息')
          }

          const assistantMsgId = genId('msg_')
          // P1-6 修复：优先使用上游真实 usage 的 completionTokens
          const nonStreamCompletionTokens = (resultData as any).usage?.completion_tokens
          const nonStreamTokenCount = nonStreamCompletionTokens ?? Math.floor(content.length / 4)
          await fastify.prisma.chatMessage.create({
            data: {
              id: assistantMsgId,
              sessionId,
              userId: req.user.id,
              role: 'assistant',
              content,
              parentMessageId: userMsg.id,
              tokenCount: nonStreamTokenCount,
            },
          })

          await fastify.prisma.chatSession.update({
            where: { id: sessionId },
            data: {
              messageCount: { increment: 1 },
              lastMessageId: assistantMsgId,
            },
          })

          // P0-5 修复：记录用量（优先用上游真实 usage）
          await recordUsage(
            req.user.id, sessionId, assistantMsgId, model,
            (resultData as any).usage,
            dto.message, content,
          )

          return {
            id: `chatcmpl_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
            sessionId,
            model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content },
                finishReason: choices[0]?.finish_reason || 'stop',
              },
            ],
            usage: {
              promptTokens: (resultData as any).usage?.prompt_tokens ?? Math.floor(dto.message.length / 4),
              completionTokens: (resultData as any).usage?.completion_tokens ?? Math.floor(content.length / 4),
              totalTokens: (resultData as any).usage?.total_tokens ?? Math.floor((dto.message.length + content.length) / 4),
            },
            createdAt: new Date().toISOString(),
          }
        }

        // ===== 流式 SSE =====
        const assistantMsgId = genId('msg_')
        const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 24)}`

        // P0-1 修复：注册 run，创建 AbortController 供 /stop 调用
        const abortController = new AbortController()
        runningRuns.set(runId, { abortController, sessionId, userId: req.user.id })

        // Fastify SSE: hijack 后直接操作 raw response
        reply.hijack()
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })

        const collectedContent: string[] = []
        const collectedReasoning: string[] = []
        let streamError = false
        // P1-6 修复：流式 usage 收集容器，由 streamAgui 末块填充
        const usageRef: { current: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined } = { current: undefined }

        // 1) RUN_STARTED（对齐 Python）
        reply.raw.write(`data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: sessionId, runId })}\n\n`)

        // 2) 流式输出 AG-UI 事件（对齐 Python: async for sse_str in llm_service.stream_agui(...)）
        try {
          for await (const sseStr of llmService.streamAgui(
            messages,
            assistantMsgId,
            model,
            dto.temperature ?? undefined,
            dto.maxTokens ?? undefined,
            abortController.signal, // P0-1：传入外部 signal
            usageRef, // P1-6：传入 usage 收集容器
          )) {
            // 收集正文/思考内容用于持久化（对齐 Python 的解析逻辑）
            if (sseStr.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(sseStr.slice(6).trim())
                const evtType = parsed.type
                if (evtType === 'TEXT_MESSAGE_CONTENT' && parsed.delta) {
                  collectedContent.push(parsed.delta)
                } else if (evtType === 'THINKING_TEXT_MESSAGE_CONTENT' && parsed.delta) {
                  collectedReasoning.push(parsed.delta)
                }
              } catch {
                // 忽略解析错误
              }
            }
            reply.raw.write(sseStr)
          }
        } catch (e) {
          streamError = true
          // 流异常时发送 RUN_ERROR（abort 时不发，因为 streamAgui 内部已处理）
          if (!abortController.signal.aborted) {
            reply.raw.write(
              `data: ${JSON.stringify({ type: 'RUN_ERROR', message: String(e), code: 'STREAM_ERROR' })}\n\n`,
            )
          }
        } finally {
          // P0-1 修复：流结束（正常/异常/中止）后从注册表移除
          runningRuns.delete(runId)
        }

        // 3) RUN_FINISHED（对齐 Python）
        // P1-6 修复：附加 usage（如上游流式末块带 usage），供前端展示用量
        const runFinishedData: Record<string, unknown> = { type: 'RUN_FINISHED', threadId: sessionId, runId }
        if (usageRef.current) {
          runFinishedData.usage = usageRef.current
        }
        reply.raw.write(`data: ${JSON.stringify(runFinishedData)}\n\n`)

        // 4) 持久化 assistant 消息（对齐 Python 的收尾逻辑）
        const fullContent = collectedContent.join('')
        const fullReasoning = collectedReasoning.join('')
        if (fullContent || fullReasoning) {
          const contentBlocks = fullReasoning
            ? [{ reasoningContent: fullReasoning }]
            : Prisma.JsonNull

          // P1-6 修复：优先使用上游真实 usage 的 completionTokens，回退到 length/4 估算
          const realCompletionTokens = usageRef.current?.completionTokens
          const tokenCount = realCompletionTokens ?? Math.floor(fullContent.length / 4)

          await fastify.prisma.chatMessage.create({
            data: {
              id: assistantMsgId,
              sessionId,
              userId: req.user.id,
              role: 'assistant',
              content: fullContent,
              contentBlocks,
              parentMessageId: userMsg.id,
              tokenCount,
            },
          })

          await fastify.prisma.chatSession.update({
            where: { id: sessionId },
            data: {
              messageCount: { increment: 1 },
              lastMessageId: assistantMsgId,
            },
          })

          // P0-5 修复：记录用量；P1-6 修复：传入流式真实 usage
          await recordUsage(
            req.user.id, sessionId, assistantMsgId, model,
            usageRef.current, dto.message, fullContent,
          )
        } else if (!streamError) {
          // P0-4 修复：流式无内容且非异常 → 回滚已写入的 userMsg，避免孤儿用户消息
          await rollbackUserMessage(sessionId, userMsg.id)
        }

        reply.raw.end()
      })

      // 对应 Python: @router.post("/completions/stop")
      // P0-1 修复：通过 sessionId 查找运行中的生成任务并 abort
      app.post('/completions/stop', buildSchema({
        body: StopGenerationRequestSchema,
        tags: ['chat'],
        summary: '停止生成',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const dto = StopGenerationRequestSchema.parse(req.body)
        // 查找当前用户在该 session 下运行中的任务
        const run = findRunBySession(dto.sessionId, req.user.id)
        if (run) {
          // abort 后 completions 路由的 finally 会自动从 runningRuns 移除
          run.abortController.abort()
        }
        return { message: 'stopped', aborted: !!run }
      })

      // ========== 反馈 ==========

      // 对应 Python: @router.post("/messages/{messageId}/feedback")
      app.post('/messages/:messageId/feedback', buildSchema({
        params: z.object({ messageId: z.string() }),
        body: FeedbackRequestSchema,
        tags: ['chat'],
        summary: '消息反馈',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { messageId } = req.params as { messageId: string }
        const dto = FeedbackRequestSchema.parse(req.body)

        const msg = await fastify.prisma.chatMessage.findFirst({
          where: { id: messageId, userId: req.user.id },
        })
        if (!msg) {
          throw new NotFoundError('消息不存在')
        }

        await fastify.prisma.chatMessage.update({
          where: { id: messageId },
          data: { feedback: dto.feedback },
        })

        return { message: '反馈已提交' }
      })

      // ========== 重新生成 ==========

      // 对应 Python: @router.post("/messages/{messageId}/regenerate")
      app.post('/messages/:messageId/regenerate', buildSchema({
        params: z.object({ messageId: z.string() }),
        body: RegenerateRequestSchema,
        tags: ['chat'],
        summary: '重新生成',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { messageId } = req.params as { messageId: string }
        const dto = RegenerateRequestSchema.parse(req.body)

        const originalMsg = await fastify.prisma.chatMessage.findFirst({
          where: { id: messageId, userId: req.user.id },
        })
        if (!originalMsg) {
          throw new NotFoundError('消息不存在')
        }

        return await doRegenerate(req.user.id, messageId, originalMsg.sessionId, dto)
      })

      // ========== 辅助函数 ==========

      // 对应 Python: _build_message_context
      async function buildMessageContext(
        sessionId: string,
        overrideSystemPrompt?: string,
      ): Promise<Message[]> {
        const messages: Message[] = []

        const session = await fastify.prisma.chatSession.findUnique({
          where: { id: sessionId },
        })

        // System prompt
        const systemPrompt = overrideSystemPrompt || session?.systemPrompt || undefined
        if (systemPrompt) {
          messages.push({ role: 'system', content: systemPrompt })
        }

        // 历史消息（最近 20 条，排除 system，对齐 Python: limit(20) + reversed）
        // P1-5 修复：同样加 id tie-breaker，保证同毫秒消息顺序稳定
        const history = await fastify.prisma.chatMessage.findMany({
          where: { sessionId, role: { not: 'system' } },
          orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          take: 20,
        })
        history.reverse()
        for (const m of history) {
          messages.push({ role: m.role, content: m.content })
        }

        return messages
      }

      // 对应 Python: _do_regenerate
      // P0-2 修复：重新生成仅写新 assistant 消息，复用既有 user 消息作为 parentMessageId
      // 不走 /completions，避免重复写入用户消息
      async function doRegenerate(
        userId: string,
        parentMessageId: string,
        sessionId: string,
        dto: { model?: string | null; temperature?: number | null; maxTokens?: number | null },
      ) {
        // P0-5 修复：重生同样校验配额
        await checkQuota(userId)

        let messages = await buildMessageContext(sessionId)

        // 找到父消息位置，只取到父消息为止
        // 注意：parentMessageId 是被重生的 assistant 消息 id，
        // 其 parentMessageId 才是触发它的 user 消息 id
        const parentMsg = await fastify.prisma.chatMessage.findUnique({
          where: { id: parentMessageId },
        })
        if (parentMsg) {
          // 若重生的是 assistant，定位其父 user 消息；若直接是 user 消息则用其本身
          const targetUserId = parentMsg.role === 'assistant' ? parentMsg.parentMessageId : parentMsg.id
          if (targetUserId) {
            const targetUserMsg = await fastify.prisma.chatMessage.findUnique({
              where: { id: targetUserId },
            })
            if (targetUserMsg) {
              const parentIdx = messages.findIndex(
                (m) => m.role === 'user' && m.content === targetUserMsg.content,
              )
              if (parentIdx >= 0) {
                messages = messages.slice(0, parentIdx + 1)
              }
            }
          }
        }

        // 非流式调 LLM
        let resultData: Record<string, unknown>
        try {
          resultData = await llmService.chatCompletion(
            messages,
            dto.model || undefined,
            dto.temperature ?? undefined,
          )
        } catch (e) {
          throw new BadGatewayError(`LLM API 错误: ${(e as Error).message}`)
        }

        const choices = (resultData as any).choices || [{}]
        const content = choices[0]?.message?.content || ''
        // P0-4 修复：空回复不写入 assistant 消息，直接报错
        if (!content) {
          throw new BadGatewayError('LLM 返回空内容')
        }

        // parentMessageId 指向触发生成的 user 消息（非被重生的 assistant）
        const userParentId = parentMsg?.role === 'assistant' ? parentMsg.parentMessageId : parentMessageId

        // P1-6 修复：优先使用上游真实 usage 的 completionTokens
        const regenCompletionTokens = (resultData as any).usage?.completion_tokens
        const regenTokenCount = regenCompletionTokens ?? Math.floor(content.length / 4)
        const newMsg = await fastify.prisma.chatMessage.create({
          data: {
            id: genId('msg_'),
            sessionId,
            userId,
            role: 'assistant',
            content,
            parentMessageId: userParentId,
            tokenCount: regenTokenCount,
          },
        })

        await fastify.prisma.chatSession.update({
          where: { id: sessionId },
          data: {
            messageCount: { increment: 1 },
            lastMessageId: newMsg.id,
          },
        })

        // P0-5 修复：记录用量
        const promptText = messages.map((m) => m.content).join('')
        await recordUsage(
          userId, sessionId, newMsg.id, dto.model || env.LLM_DEFAULT_MODEL,
          (resultData as any).usage, promptText, content,
        )

        return {
          id: newMsg.id,
          sessionId: newMsg.sessionId,
          role: newMsg.role,
          content: newMsg.content,
          contentBlocks: newMsg.contentBlocks,
          tokenCount: newMsg.tokenCount,
          feedback: newMsg.feedback ?? 'none',
          metadata: newMsg.extraMetadata,
          parentMessageId: newMsg.parentMessageId,
          createdAt: newMsg.createdAt,
          updatedAt: newMsg.updatedAt,
        }
      }
    },
    { prefix: '/chat' },
  )
}
