// Agent 路由 —— 对应 Python app/api/v1/agent.py
import { FastifyPluginAsync } from 'fastify'
import type { PrismaClient, ChatSession, ChatMessage, AgentToolExecution } from '@prisma/client'
import { z } from 'zod'
import { authGuard } from '../plugins/auth.js'
import { NotFoundError } from '../plugins/error-handler.js'
import { genId } from '../utils/id.js'
import { env } from '../config/env.js'
import { buildSchema } from '../utils/zod-schema.js'
import {
  CreateAgentSessionRequestSchema,
  AgentChatRequestSchema,
  AgentFeedbackRequestSchema,
} from '../schemas/agent.js'

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
      // 暂未迁移（依赖 ModuAgent 框架）—— 返回 501 Not Implemented
      app.post('/completions', buildSchema({
        body: AgentChatRequestSchema,
        tags: ['agent'],
        summary: 'Agent 对话（暂未迁移）',
        description: '依赖 ModuAgent 框架，待 packages/modu-agent 就绪后接入',
        security: [{ BearerAuth: [] }],
      }), async (req, reply) => {
        return reply.code(501).send({
          code: 501,
          message: 'Agent 对话端点暂未迁移，依赖 ModuAgent 框架（待 packages/modu-agent 就绪后接入）',
        })
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

        const execRecord = await fastify.prisma.agentToolExecution.findUnique({
          where: { id: executionId },
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
