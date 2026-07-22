// Agent 路由 —— 对应 Python app/api/v1/agent.py
import { FastifyPluginAsync } from 'fastify'
import { Prisma, type PrismaClient, type ChatSession, type ChatMessage, type AgentToolExecution } from '@prisma/client'
import { z } from 'zod'
import { authGuard } from '../plugins/auth.js'
import { isOriginAllowed } from '../plugins/cors.js'
import { NotFoundError } from '../plugins/error-handler.js'
import { genId } from '../utils/id.js'
import { env } from '../config/env.js'
import { buildSchema } from '../utils/zod-schema.js'
import {
  CreateAgentSessionRequestSchema,
  AgentChatRequestSchema,
  AgentFeedbackRequestSchema,
} from '../schemas/agent.js'
import { StreamContext, streamAgentCompletion } from '../core/agent-bridge.js'

// 对应 Python: _verify_session_owner
// 验证会话存在且属于当前用户，否则抛 NotFoundError("会话不存在")
async function verifySessionOwner(
  prisma: PrismaClient,
  sessionId: string,
  userId: string,
): Promise<ChatSession> {
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
  })
  if (!session) {
    throw new NotFoundError('会话不存在')
  }
  return session
}

// 对应 Python: _session_to_response
// 注意字段映射：agentMode、modelConfig、systemPrompt、messageCount
function sessionToResponse(s: ChatSession) {
  return {
    id: s.id,
    title: s.title,
    agentMode: s.agentMode,
    model: s.model,
    modelConfig: s.modelConfig,
    systemPrompt: s.systemPrompt,
    messageCount: s.messageCount ?? 0,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }
}

// 对应 Python: _message_to_response
// 注意字段映射：promptTokens、completionTokens、latencyMs、userRating、userFeedback
function messageToResponse(m: ChatMessage) {
  return {
    id: m.id,
    sessionId: m.sessionId,
    role: m.role,
    content: m.content ?? '',
    contentBlocks: m.contentBlocks,
    promptTokens: m.promptTokens,
    completionTokens: m.completionTokens,
    latencyMs: m.latencyMs,
    userRating: m.userRating,
    userFeedback: m.userFeedback,
    createdAt: m.createdAt,
  }
}

// 对应 Python: _execution_to_detail
// 注意：列表视图 outputResult 固定为 null（对齐 Python），output_result 仅在 /executions/:id/result 返回
function executionToDetail(e: AgentToolExecution) {
  return {
    id: e.id,
    messageId: e.messageId,
    toolName: e.toolName ?? '',
    toolCallId: e.toolCallId,
    inputParams: e.inputParams,
    outputSummary: e.outputSummary,
    outputResult: null,
    status: e.status ?? 'pending',
    errorMessage: e.errorMessage,
    durationMs: e.durationMs,
    startTime: e.startTime,
    endTime: e.endTime,
  }
}

// 对应 Python: _load_session_history
// 从数据库加载会话历史消息，供 LLM 多轮上下文使用。
// 最近 limit 条按时间倒序取，再反转为正序（旧→新）。
async function loadSessionHistory(
  prisma: PrismaClient,
  sessionId: string,
  limit = 20,
): Promise<{ role: string; content: string }[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  messages.reverse()
  return messages.map((m) => ({
    role: m.role,
    content: m.content ?? '',
  }))
}

// 对应 Python: agent_completion 中的持久化逻辑
// 流结束后持久化 assistant 消息 + 工具执行记录，并更新会话计数
async function persistAssistantMessage(
  prisma: PrismaClient,
  opts: { sessionId: string; userId: string; ctx: StreamContext },
): Promise<ChatMessage> {
  const { sessionId, userId, ctx } = opts
  const assistantMsgId = genId('msg_')

  const assistantMsg = await prisma.chatMessage.create({
    data: {
      id: assistantMsgId,
      sessionId,
      userId,
      role: 'assistant',
      content: ctx.answerContent,
      contentBlocks: ctx.contentBlocks.length > 0 ? ctx.contentBlocks : Prisma.JsonNull,
      promptTokens: ctx.promptTokens || null,
      completionTokens: ctx.completionTokens || null,
      latencyMs: ctx.latencyMs || null,
    },
  })

  // 持久化工具执行记录（对应 Python: for te in ctx.tool_executions: ...）
  for (const te of ctx.toolExecutions) {
    await prisma.agentToolExecution.create({
      data: {
        id: genId('exec_'),
        messageId: assistantMsgId,
        sessionId,
        userId,
        toolName: te.toolName ?? '',
        toolCallId: te.executionId ?? null,
        inputParams: te.inputParams ?? Prisma.JsonNull,
        outputResult: te.outputResult ?? null,
        outputSummary: te.outputSummary ?? null,
        status: te.status ?? 'pending',
        errorMessage: te.errorMessage ?? null,
      },
    })
  }

  // 更新会话计数（对应 Python: session.message_count += 1; session.last_message_id = ...）
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      messageCount: { increment: 1 },
      lastMessageId: assistantMsgId,
    },
  })

  return assistantMsg
}

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  // 对应 Python: APIRouter(prefix="/agent")
  fastify.register(
    async (app) => {
      // 对应 Python: Depends(get_current_user) —— 所有端点都需要认证
      app.addHook('preHandler', authGuard)

      // ========== 会话管理 ==========

      // 对应 Python: @router.post("/sessions", status_code=201)
      app.post('/sessions', buildSchema({
        body: CreateAgentSessionRequestSchema,
        tags: ['agent'],
        summary: '创建 Agent 会话',
        security: [{ BearerAuth: [] }],
      }), async (req, reply) => {
        const dto = CreateAgentSessionRequestSchema.parse(req.body)

        // 对应 Python: session = ChatSession(id=_gen_id("sess_"), ...)
        // 对应 Python: if dto.tools: session.model_config = {"tools": dto.tools}
        const session = await fastify.prisma.chatSession.create({
          data: {
            id: genId('sess_'),
            userId: req.user.id,
            title: dto.title || '新对话',
            model: dto.model || env.LLM_DEFAULT_MODEL,
            systemPrompt: dto.systemPrompt ?? null,
            agentMode: dto.agentMode ?? null,
            // 空数组在 Python 中为 falsy，这里用 length 判断保持等价
            ...(dto.tools && dto.tools.length > 0
              ? { modelConfig: { tools: dto.tools } }
              : {}),
          },
        })

        // Prisma create 返回值即最新（对齐 Python: await db.refresh(session)）
        reply.code(201)
        return sessionToResponse(session)
      })

      // 对应 Python: @router.get("/sessions/{sessionId}")
      app.get('/sessions/:sessionId', buildSchema({
        params: z.object({ sessionId: z.string() }),
        tags: ['agent'],
        summary: '获取会话详情',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { sessionId } = req.params as { sessionId: string }
        const session = await verifySessionOwner(fastify.prisma, sessionId, req.user.id)
        return sessionToResponse(session)
      })

      // 对应 Python: @router.get("/sessions/{sessionId}/messages")
      app.get('/sessions/:sessionId/messages', buildSchema({
        params: z.object({ sessionId: z.string() }),
        tags: ['agent'],
        summary: '获取会话消息列表',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { sessionId } = req.params as { sessionId: string }
        await verifySessionOwner(fastify.prisma, sessionId, req.user.id)

        const messages = await fastify.prisma.chatMessage.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'asc' },
        })
        return messages.map(messageToResponse)
      })

      // ========== 对话执行 ==========

      // 对应 Python: @router.post("/completions")
      app.post('/completions', buildSchema({
        body: AgentChatRequestSchema,
        tags: ['agent'],
        summary: 'Agent 对话',
        description: 'AG-UI 流式/非流式 Agent 对话，基于 ModuAgent LangGraph 引擎',
        security: [{ BearerAuth: [] }],
      }), async (req, reply) => {
        const dto = AgentChatRequestSchema.parse(req.body)
        const userId = req.user.id

        // 1. 无 sessionId 则创建会话（对应 Python agent.py:182-193）
        let sessionId = dto.sessionId
        let session: ChatSession | null = null
        if (!sessionId) {
          session = await fastify.prisma.chatSession.create({
            data: {
              id: genId('sess_'),
              userId,
              title: dto.message.slice(0, 50),
              model: env.LLM_DEFAULT_MODEL,
              // P4: 使用请求指定的 agentMode（plan_execute / react_agent）
              agentMode: dto.agentMode,
            },
          })
          sessionId = session.id
        } else {
          session = await verifySessionOwner(fastify.prisma, sessionId, userId)
        }

        // 2. 写入用户消息（对应 Python: user_msg = ChatMessage(...)）
        const userMsg = await fastify.prisma.chatMessage.create({
          data: {
            id: genId('msg_'),
            sessionId,
            userId,
            role: 'user',
            content: dto.message,
          },
        })

        // 3. messageCount++（对应 Python: session.message_count += 1）
        await fastify.prisma.chatSession.update({
          where: { id: sessionId },
          data: { messageCount: { increment: 1 } },
        })

        // 4. 加载会话历史（包含刚写入的用户消息，对齐 Python）
        const history = await loadSessionHistory(fastify.prisma, sessionId)

        // 使用后端配置的默认模型（对齐 Python: model=None 忽略会话 model）
        const systemPrompt = session?.systemPrompt ?? null

        if (dto.stream) {
          // ===== 流式 SSE =====
          // Fastify SSE: hijack 后直接操作 raw response
          // 注意：hijack 会绕过 onSend 钩子，需手动补 CORS 头
          const reqOrigin = req.headers.origin
          const corsHeaders: Record<string, string> = {}
          if (reqOrigin && isOriginAllowed(reqOrigin)) {
            corsHeaders['Access-Control-Allow-Origin'] = reqOrigin
            corsHeaders['Access-Control-Allow-Credentials'] = 'true'
          }
          reply.hijack()
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            ...corsHeaders,
          })

          const ctx = new StreamContext()
          let streamError = false
          let sseCount = 0

          fastify.log.info(
            { sessionId, userId, agentMode: dto.agentMode, messageLen: dto.message.length },
            '[agent.completions] stream.start',
          )

          try {
            // streamAgentCompletion 内部已通过 AGUIStreamAdapter 发出 RUN_STARTED/RUN_FINISHED
            for await (const eventDict of streamAgentCompletion({
              message: dto.message,
              sessionId,
              userId,
              ctx,
              model: null,
              systemPrompt,
              history,
              // P4: 透传 agentMode 以启用 Plan-Execute 图
              agentMode: dto.agentMode,
            })) {
              sseCount++
              reply.raw.write(`data: ${eventDict.data}\n\n`)
            }
          } catch (e: any) {
            // 防御 create_agent() 等流前异常（流中异常已在 streamAgentCompletion 内 catch）
            streamError = true
            fastify.log.error(
              { err: e, sessionId },
              '[agent.completions] stream.pre_stream_error',
            )
            reply.raw.write(
              `data: ${JSON.stringify({ type: 'RUN_ERROR', code: 'INTERNAL', message: String(e) })}\n\n`,
            )
          }

          fastify.log.info(
            { sessionId, sseCount, streamError, answerLen: ctx.answerContent.length },
            '[agent.completions] stream.end',
          )

          // 5. 持久化 assistant 消息（对应 Python: 流结束后持久化）
          // 流前异常时不持久化（对齐 Python: event_generator 抛错时持久化代码不执行）
          if (!streamError) {
            try {
              await persistAssistantMessage(fastify.prisma, { sessionId, userId, ctx })
            } catch (e: any) {
              // 持久化失败不影响已发送的 SSE 流
              fastify.log.error({ err: e, sessionId }, 'Failed to persist agent assistant message')
            }
          }

          reply.raw.end()
          return
        }

        // ===== 非流式 =====
        const ctx = new StreamContext()
        for await (const _ of streamAgentCompletion({
          message: dto.message,
          sessionId,
          userId,
          ctx,
          model: null,
          systemPrompt,
          history,
          // P4: 透传 agentMode 以启用 Plan-Execute 图
          agentMode: dto.agentMode,
        })) {
          // 仅消费，不输出
        }

        const assistantMsg = await persistAssistantMessage(fastify.prisma, { sessionId, userId, ctx })
        return messageToResponse(assistantMsg)
      })

      // ========== 工具执行轨迹查询 ==========

      // 对应 Python: @router.get("/messages/{messageId}/executions")
      app.get('/messages/:messageId/executions', buildSchema({
        params: z.object({ messageId: z.string() }),
        tags: ['agent'],
        summary: '查询消息的工具执行记录',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { messageId } = req.params as { messageId: string }

        // 验证消息存在且属于当前用户
        const msg = await fastify.prisma.chatMessage.findFirst({
          where: { id: messageId, userId: req.user.id },
        })
        if (!msg) {
          throw new NotFoundError('消息不存在')
        }

        const executions = await fastify.prisma.agentToolExecution.findMany({
          where: { messageId },
          orderBy: { createdAt: 'asc' },
        })

        return { executions: executions.map(executionToDetail) }
      })

      // 对应 Python: @router.get("/executions/{executionId}/result")
      app.get('/executions/:executionId/result', buildSchema({
        params: z.object({ executionId: z.string() }),
        tags: ['agent'],
        summary: '查询执行结果',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { executionId } = req.params as { executionId: string }

        // P1-1 修复 IDOR：加 userId 过滤，防止越权读取他人执行结果
        const execRecord = await fastify.prisma.agentToolExecution.findFirst({
          where: { id: executionId, userId: req.user.id },
        })
        if (!execRecord) {
          throw new NotFoundError('执行记录不存在')
        }

        return {
          executionId: execRecord.id,
          outputResult: execRecord.outputResult,
        }
      })

      // ========== 深度反馈闭环 ==========

      // 对应 Python: @router.post("/messages/{messageId}/feedback")
      app.post('/messages/:messageId/feedback', buildSchema({
        params: z.object({ messageId: z.string() }),
        body: AgentFeedbackRequestSchema,
        tags: ['agent'],
        summary: '提交消息反馈',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { messageId } = req.params as { messageId: string }
        const dto = AgentFeedbackRequestSchema.parse(req.body)

        // 验证消息存在且属于当前用户
        const msg = await fastify.prisma.chatMessage.findFirst({
          where: { id: messageId, userId: req.user.id },
        })
        if (!msg) {
          throw new NotFoundError('消息不存在')
        }

        // Prisma update 已自动提交（对齐 Python: await db.commit()）
        await fastify.prisma.chatMessage.update({
          where: { id: messageId },
          data: {
            userRating: dto.rating,
            userFeedback: dto.feedbackText ?? null,
          },
        })

        return { message: '反馈已提交' }
      })
    },
    { prefix: '/agent' },
  )
}
