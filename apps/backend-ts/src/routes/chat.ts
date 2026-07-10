// Chat 路由 —— 对应 Python app/api/v1/chat.py
// 含会话 CRUD、消息游标分页、对话补全（流式 SSE + 非流式）、反馈、重新生成
import { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'
import { authGuard } from '../plugins/auth.js'
import { NotFoundError, ForbiddenError, BadGatewayError } from '../plugins/error-handler.js'
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

      // ========== 会话 ==========

      // 对应 Python: @router.get("/sessions")
      app.get('/sessions', buildSchema({
        querystring: z.object({
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(100).optional(),
          archived: z.boolean().optional(),
        }),
        tags: ['chat'],
        summary: '会话列表',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const query = req.query as {
          page?: string
          pageSize?: string
          archived?: string
        }
        const page = Math.max(1, parseInt(query.page || '1') || 1)
        const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || '20') || 20))
        const archived = query.archived === 'true' ? true : query.archived === 'false' ? false : undefined

        const where: Record<string, unknown> = { userId: req.user.id }
        if (archived !== undefined) {
          where.isArchived = archived
        }

        const [total, sessions] = await Promise.all([
          fastify.prisma.chatSession.count({ where }),
          fastify.prisma.chatSession.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
        ])

        // 对应 Python: 逐 session 查询最后一条消息
        const sessionList = await Promise.all(
          sessions.map(async (s) => {
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

        return { sessions: sessionList, total, page, pageSize }
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

        const updated = await fastify.prisma.chatSession.update({
          where: { id: sessionId },
          data,
        })

        return {
          id: updated.id,
          title: updated.title,
          model: updated.model,
          modelConfig: updated.modelConfig,
          messageCount: updated.messageCount ?? 0,
          lastMessage: null,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          isArchived: updated.isArchived ?? false,
        }
      })

      // 对应 Python: @router.delete("/sessions/{sessionId}")
      app.delete('/sessions/:sessionId', buildSchema({
        params: z.object({ sessionId: z.string() }),
        querystring: z.object({ archive: z.boolean().optional() }),
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
          // 彻底删除（先删消息再删会话，对齐 Python 的级联删除）
          await fastify.prisma.chatMessage.deleteMany({
            where: { sessionId },
          })
          await fastify.prisma.chatSession.delete({
            where: { id: sessionId },
          })
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

        // 游标分页（对齐 Python: cursor 查找 + created_at 比较）
        const where: Record<string, unknown> = { sessionId }
        if (query.cursor) {
          const cursorMsg = await fastify.prisma.chatMessage.findUnique({
            where: { id: query.cursor },
          })
          if (cursorMsg) {
            if (direction === 'before') {
              where.createdAt = { lt: cursorMsg.createdAt }
            } else {
              where.createdAt = { gt: cursorMsg.createdAt }
            }
          }
        }

        const messages = await fastify.prisma.chatMessage.findMany({
          where,
          orderBy: { createdAt: direction === 'before' ? 'desc' : 'asc' },
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

      // 对应 Python: @router.post("/completions")
      app.post('/completions', buildSchema({
        body: ChatCompletionRequestSchema,
        tags: ['chat'],
        summary: '对话补全（流式 SSE / 非流式）',
        security: [{ BearerAuth: [] }],
      }), async (req, reply) => {
        const dto = ChatCompletionRequestSchema.parse(req.body)

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

        // 构建消息上下文
        const messages = await buildMessageContext(sessionId, dto.systemPrompt ?? undefined)
        messages.push({ role: 'user', content: dto.message })

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
            throw new BadGatewayError(`LLM API 错误: ${(e as Error).message}`)
          }

          const choices = (resultData as any).choices || [{}]
          const content = choices[0]?.message?.content || ''

          const assistantMsgId = genId('msg_')
          await fastify.prisma.chatMessage.create({
            data: {
              id: assistantMsgId,
              sessionId,
              userId: req.user.id,
              role: 'assistant',
              content,
              parentMessageId: userMsg.id,
              tokenCount: Math.floor(content.length / 4),
            },
          })

          await fastify.prisma.chatSession.update({
            where: { id: sessionId },
            data: {
              messageCount: { increment: 1 },
              lastMessageId: assistantMsgId,
            },
          })

          return {
            id: `chatcmpl_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
            sessionId,
            model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content },
                finishReason: 'stop',
              },
            ],
            usage: {
              promptTokens: Math.floor(dto.message.length / 4),
              completionTokens: Math.floor(content.length / 4),
              totalTokens: Math.floor((dto.message.length + content.length) / 4),
            },
            createdAt: new Date().toISOString(),
          }
        }

        // ===== 流式 SSE =====
        const assistantMsgId = genId('msg_')
        const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 24)}`

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
          // 流异常时发送 RUN_ERROR
          reply.raw.write(
            `data: ${JSON.stringify({ type: 'RUN_ERROR', message: String(e), code: 'STREAM_ERROR' })}\n\n`,
          )
        }

        // 3) RUN_FINISHED（对齐 Python）
        reply.raw.write(`data: ${JSON.stringify({ type: 'RUN_FINISHED', threadId: sessionId, runId })}\n\n`)

        // 4) 持久化 assistant 消息（对齐 Python 的收尾逻辑）
        const fullContent = collectedContent.join('')
        const fullReasoning = collectedReasoning.join('')
        if (fullContent || fullReasoning) {
          const contentBlocks = fullReasoning
            ? [{ reasoningContent: fullReasoning }]
            : Prisma.JsonNull

          await fastify.prisma.chatMessage.create({
            data: {
              id: assistantMsgId,
              sessionId,
              userId: req.user.id,
              role: 'assistant',
              content: fullContent,
              contentBlocks,
              parentMessageId: userMsg.id,
              tokenCount: Math.floor(fullContent.length / 4),
            },
          })

          await fastify.prisma.chatSession.update({
            where: { id: sessionId },
            data: {
              messageCount: { increment: 1 },
              lastMessageId: assistantMsgId,
            },
          })
        }

        reply.raw.end()
      })

      // 对应 Python: @router.post("/completions/stop")
      app.post('/completions/stop', buildSchema({
        body: StopGenerationRequestSchema,
        tags: ['chat'],
        summary: '停止生成',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        // 校验请求体（对齐 Python 接收 StopGenerationRequest）
        StopGenerationRequestSchema.parse(req.body)
        return { message: 'stopped' }
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
        const history = await fastify.prisma.chatMessage.findMany({
          where: { sessionId, role: { not: 'system' } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
        history.reverse()
        for (const m of history) {
          messages.push({ role: m.role, content: m.content })
        }

        return messages
      }

      // 对应 Python: _do_regenerate
      async function doRegenerate(
        userId: string,
        parentMessageId: string,
        sessionId: string,
        dto: { model?: string | null; temperature?: number | null; maxTokens?: number | null },
      ) {
        let messages = await buildMessageContext(sessionId)

        // 找到父消息位置，只取到父消息为止
        const parentMsg = await fastify.prisma.chatMessage.findUnique({
          where: { id: parentMessageId },
        })
        if (parentMsg) {
          const parentIdx = messages.findIndex(
            (m) => m.role === 'user' && m.content === parentMsg.content,
          )
          if (parentIdx >= 0) {
            messages = messages.slice(0, parentIdx + 1)
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

        const newMsg = await fastify.prisma.chatMessage.create({
          data: {
            id: genId('msg_'),
            sessionId,
            userId,
            role: 'assistant',
            content,
            parentMessageId,
            tokenCount: Math.floor(content.length / 4),
          },
        })

        await fastify.prisma.chatSession.update({
          where: { id: sessionId },
          data: {
            messageCount: { increment: 1 },
            lastMessageId: newMsg.id,
          },
        })

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
