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
  AgentResumeRequestSchema,
  AgentAbortRequestSchema,
} from '../schemas/agent.js'
import { StopGenerationRequestSchema } from '../schemas/chat.js'
import { StreamContext, streamAgentCompletion, streamAgentResume, getPendingAgentState, mergePlanSteps, collectMetadataFromEvent } from '../core/agent-bridge.js'
import { checkInterruptTimeout, get_runner, resume_sync } from '@pioneering/modu-agent'

// ===== Agent 流式运行注册表（供 /agent/completions/stop 中止生成）=====
// 对齐 chat.ts 的 runningRuns：注册当前用户的运行中生成任务，
// /completions/stop 按 sessionId+userId 查找并 abort，SSE 写循环检测到中止后退出。
interface AgentRunningRun {
  sessionId: string
  userId: string
  controller: AbortController
}
const agentRunningRuns = new Map<string, AgentRunningRun>()

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
// P4: 补 metadata 字段（Prisma 字段名为 extraMetadata，映射到 DB 列 metadata），
//     供前端判断该 assistant 消息是否含 plan 数据（metadata.plan_phase 存在即关联了持久化步骤）。
function messageToResponse(m: ChatMessage) {
  return {
    id: m.id,
    sessionId: m.sessionId,
    role: m.role,
    content: m.content ?? '',
    contentBlocks: m.contentBlocks,
    metadata: m.extraMetadata,
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
// 流结束后持久化 assistant 消息 + 工具执行记录 + plan 步骤终态，并更新会话计数
// P4: 新增 plan_steps 持久化（仅当本次产生过 plan 数据时），
//     并在 chat_messages.metadata 写入 plan_phase / plan_error 终态元数据。
//     注意：Prisma 字段名为 extraMetadata（映射到 DB 列 metadata），写入时使用 extraMetadata。
async function persistAssistantMessage(
  prisma: PrismaClient,
  opts: { sessionId: string; userId: string; ctx: StreamContext },
): Promise<{ assistantMsg: ChatMessage; planStepsCount: number }> {
  const { sessionId, userId, ctx } = opts
  const assistantMsgId = genId('msg_')

  // 仅当本次产生过 plan 数据时才写入 metadata（避免污染非 plan_execute 消息）
  const hasPlanData = ctx.planData.length > 0
  const extraMetadata = hasPlanData
    ? { plan_phase: ctx.planPhase ?? 'done', plan_error: ctx.planError }
    : undefined

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
      // P4: plan 终态元数据（Prisma 字段名 extraMetadata，映射 DB 列 metadata）
      extraMetadata: extraMetadata ?? undefined,
    },
  })

  // ===== P4 新增：持久化 plan 步骤终态 =====
  let planStepsCount = 0
  if (hasPlanData) {
    const merged = mergePlanSteps(ctx.planData, ctx.stepUpdates)
    for (let i = 0; i < merged.length; i++) {
      const s = merged[i]
      await prisma.planStep.create({
        data: {
          id: genId('pstep_'),
          messageId: assistantMsgId,
          sessionId,
          userId,
          stepId: s.step_id,
          stepIndex: i,
          title: s.title,
          description: s.description ?? null,
          dependsOn: s.depends_on ?? undefined,
          status: s.status,
          result: s.result ?? null,
          error: s.error ?? null,
          startedAt: s.started_at ? new Date(s.started_at) : null,
          finishedAt: s.finished_at ? new Date(s.finished_at) : null,
        },
      })
    }
    planStepsCount = merged.length
  }

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

  return { assistantMsg, planStepsCount }
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
              title: dto.message.slice(0, 50) || '新对话',
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

          // 注册运行（供 /completions/stop 中止本流），连接关闭时自动清理
          const stopController = new AbortController()
          const stopRunId = genId('arun_')
          agentRunningRuns.set(stopRunId, { sessionId, userId, controller: stopController })
          reply.raw.on('close', () => {
            agentRunningRuns.delete(stopRunId)
          })

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
              if (stopController.signal.aborted) {
                fastify.log.info({ sessionId }, '[agent.completions] stream aborted by /stop')
                break
              }
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
          // HITL（阶段零 D2）：被 interrupt 暂停的 run 不持久化空/半截 assistant 消息，
          // 待 resume 后由 /agent/resume 落库为完整终态消息。
          if (!streamError && !ctx.paused) {
            try {
              const { planStepsCount } = await persistAssistantMessage(fastify.prisma, { sessionId, userId, ctx })
              if (planStepsCount > 0) {
                fastify.log.info(
                  { sessionId, planStepsCount },
                  '[agent.completions] persist.plan_steps',
                )
              }
            } catch (e: any) {
              // 持久化失败不影响已发送的 SSE 流
              fastify.log.error({ err: e, sessionId }, 'Failed to persist agent assistant message')
            }
          } else if (ctx.paused) {
            fastify.log.info(
              { sessionId },
              '[agent.completions] skip_persist.run_paused',
            )
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

        const { assistantMsg, planStepsCount } = await persistAssistantMessage(fastify.prisma, { sessionId, userId, ctx })
        if (planStepsCount > 0) {
          fastify.log.info(
            { sessionId, planStepsCount },
            '[agent.completions] persist.plan_steps',
          )
        }
        return messageToResponse(assistantMsg)
      })

      // 对应 Python: @router.post("/completions/stop")
      // 通过 sessionId 查找该用户运行中的 Agent 生成任务并 abort（对齐 chat.ts 的实现）。
      app.post('/completions/stop', buildSchema({
        body: StopGenerationRequestSchema,
        tags: ['agent'],
        summary: '停止 Agent 生成',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const dto = StopGenerationRequestSchema.parse(req.body)
        let aborted = false
        for (const run of agentRunningRuns.values()) {
          if (run.sessionId === dto.sessionId && run.userId === req.user.id) {
            run.controller.abort()
            aborted = true
          }
        }
        return { message: 'stopped', aborted }
      })

      // ========== HITL（Human-in-the-Loop）=====
      // 阶段一 1.4：resume / state / abort 三个端点（均带 authGuard + 会话归属校验）

      // POST /agent/resume —— 恢复被 interrupt 暂停的 run，返回 SSE 流。
      // body: { sessionId, approved, feedback?, modifiedArgs? }（对应 Command(resume) 载荷）
      app.post('/resume', buildSchema({
        body: AgentResumeRequestSchema,
        tags: ['agent'],
        summary: '恢复被中断的 Agent 运行（HITL）',
        description: '对 interrupt 暂停的 run 提交审批结果（approved/feedback/modified_args），返回 AG-UI SSE 流',
        security: [{ BearerAuth: [] }],
      }), async (req, reply) => {
        const dto = AgentResumeRequestSchema.parse(req.body)
        const userId = req.user.id

        // 1. 会话归属校验（防 IDOR，复用 verifySessionOwner）
        await verifySessionOwner(fastify.prisma, dto.sessionId, userId)

        // 2. 确认确实处于 interrupt 暂停状态（不在暂停态则拒绝，避免误 resume）
        const pending = await getPendingAgentState(dto.sessionId, userId)
        if (pending === null) {
          throw new NotFoundError('会话不存在待审批的暂停项')
        }

        // 3. SSE 输出（与 /agent/completions 同款 hijack）
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

        let sseCount = 0
        let streamError = false
        const ctx = new StreamContext()
        try {
          for await (const eventDict of streamAgentResume({
            sessionId: dto.sessionId,
            userId,
            approved: dto.approved,
            feedback: dto.feedback ?? '',
            modifiedArgs: dto.modifiedArgs ?? undefined,
          })) {
            sseCount++
            reply.raw.write(`data: ${eventDict.data}\n\n`)
            // 复用 collectMetadataFromEvent 收集元数据（RUN_PAUSED 会再次置 ctx.paused）
            collectMetadataFromEvent(eventDict, ctx)
          }
        } catch (e: any) {
          streamError = true
          fastify.log.error(
            { err: e, sessionId: dto.sessionId },
            '[agent.resume] stream.pre_stream_error',
          )
          reply.raw.write(
            `data: ${JSON.stringify({ type: 'RUN_ERROR', code: 'INTERNAL', message: String(e) })}\n\n`,
          )
        }

        fastify.log.info(
          { sessionId: dto.sessionId, approved: dto.approved, sseCount, streamError, paused: ctx.paused },
          '[agent.resume] stream.end',
        )

        // resume 正常完成（未再次暂停、无错误）→ 落库完整终态 assistant 消息（阶段零 D2）
        if (!streamError && !ctx.paused) {
          try {
            await persistAssistantMessage(fastify.prisma, {
              sessionId: dto.sessionId,
              userId,
              ctx,
            })
          } catch (e: any) {
            fastify.log.error({ err: e, sessionId: dto.sessionId }, 'Failed to persist resume assistant message')
          }
        } else if (ctx.paused) {
          // 再次被 interrupt 暂停（串行多轮审批）→ 不持久化，前端继续等待下一轮答复
          fastify.log.info(
            { sessionId: dto.sessionId },
            '[agent.resume] skip_persist.re_paused',
          )
        }

        reply.raw.end()
      })

      // GET /agent/state/:threadId —— 查询 pending interrupt 状态（前端进页/重连恢复）
      app.get('/state/:threadId', buildSchema({
        params: z.object({ threadId: z.string() }),
        tags: ['agent'],
        summary: '查询会话的待答复 HITL 状态',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { threadId } = req.params as { threadId: string }
        // 会话归属校验（防 IDOR）
        await verifySessionOwner(fastify.prisma, threadId, req.user.id)

        // 超时治理：查询前先检查是否超时（超时则自动拒绝并返回已过期）
        try {
          const timeoutStatus = await checkInterruptTimeout(
            await get_runner(),
            threadId,
          )
          if (timeoutStatus === 'expired') {
            return {
              session_id: threadId,
              pending: false,
              expired: true,
            }
          }
        } catch (e: any) {
          fastify.log.debug({ err: e, threadId }, '[agent.state] timeout check skipped')
        }

        const state = await getPendingAgentState(threadId, req.user.id)
        if (state === null) {
          return { session_id: threadId, pending: false }
        }
        return { ...state, pending: true }
      })

      // POST /agent/abort —— 对中断执行拒绝/取消语义（超时/用户取消后收尾）
      app.post('/abort', buildSchema({
        body: AgentAbortRequestSchema,
        tags: ['agent'],
        summary: '中止/拒绝 HITL 待答复项',
        security: [{ BearerAuth: [] }],
      }), async (req, reply) => {
        const dto = AgentAbortRequestSchema.parse(req.body)
        const userId = req.user.id

        // 会话归属校验（防 IDOR）
        await verifySessionOwner(fastify.prisma, dto.sessionId, userId)

        // 确认存在待答复项
        const pending = await getPendingAgentState(dto.sessionId, userId)
        if (pending === null) {
          return { message: 'no_pending_interrupt', aborted: false }
        }

        // 复用 resume_sync(approved=false) 触发拒绝路径（时间语义与超时自动拒绝一致）
        const graph = await get_runner()
        const result = await resume_sync(
          graph,
          dto.sessionId,
          false,
          `user ${dto.reason}`,
          `hitl-abort-${dto.sessionId}-${Date.now()}`,
        )
        if (result && result['status'] === 'error') {
          fastify.log.error(
            { sessionId: dto.sessionId, reason: dto.reason, errorCode: result['error_code'] ?? '' },
            '[agent.abort] resume_sync returned error',
          )
          return { message: 'abort_failed', aborted: false, error: result['error_code'] ?? '' }
        }

        fastify.log.info(
          { sessionId: dto.sessionId, reason: dto.reason },
          '[agent.abort] interrupted run rejected',
        )
        return { message: 'aborted', aborted: true }
      })

      // ========== Plan 步骤时间轴恢复 ==========

      // GET /agent/messages/:messageId/plan
      // 返回该 assistant 消息关联的 plan 步骤快照（按 step_index 升序），
      // 供前端 hydrateFromHistory 恢复历史时间轴。
      // 注意：Prisma 字段名为 extraMetadata（映射 DB 列 metadata）。
      app.get('/messages/:messageId/plan', buildSchema({
        params: z.object({ messageId: z.string() }),
        tags: ['agent'],
        summary: '获取消息的任务步骤时间轴（持久化恢复用）',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { messageId } = req.params as { messageId: string }
        const msg = await fastify.prisma.chatMessage.findFirst({
          where: { id: messageId, userId: req.user.id },
        })
        if (!msg) throw new NotFoundError('消息不存在')

        const steps = await fastify.prisma.planStep.findMany({
          where: { messageId },
          orderBy: { stepIndex: 'asc' },
        })
        const meta = (msg.extraMetadata as any) ?? {}
        return {
          messageId,
          phase: meta.plan_phase ?? null,
          error: meta.plan_error ?? null,
          collapsedSteps: meta.collapsed_steps ?? {},
          steps: steps.map((s) => ({
            step_id: s.stepId,
            step_index: s.stepIndex,
            title: s.title,
            description: s.description ?? '',
            depends_on: s.dependsOn ?? [],
            status: s.status,
            result: s.result ?? undefined,
            error: s.error ?? undefined,
            started_at: s.startedAt ? new Date(s.startedAt).getTime() : undefined,
            finished_at: s.finishedAt ? new Date(s.finishedAt).getTime() : undefined,
            duration_ms: s.durationMs ?? undefined,
          })),
        }
      })

      // POST /agent/messages/:messageId/plan/collapsed
      // 回传用户手动折叠状态快照（流结束后由前端调用，保视觉细节）。
      // 合并现有 metadata（保留 plan_phase/plan_error），追加 collapsed_steps。
      app.post('/messages/:messageId/plan/collapsed', buildSchema({
        params: z.object({ messageId: z.string() }),
        body: z.object({ collapsedSteps: z.record(z.boolean()) }),
        tags: ['agent'],
        summary: '回传时间轴折叠状态快照',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { messageId } = req.params as { messageId: string }
        const dto = req.body as { collapsedSteps: Record<string, boolean> }
        const msg = await fastify.prisma.chatMessage.findFirst({
          where: { id: messageId, userId: req.user.id },
        })
        if (!msg) throw new NotFoundError('消息不存在')

        // 合并现有 metadata（保留 plan_phase/plan_error），追加 collapsed_steps
        const existingMeta = (msg.extraMetadata as any) ?? {}
        const newMeta = { ...existingMeta, collapsed_steps: dto.collapsedSteps }
        await fastify.prisma.chatMessage.update({
          where: { id: messageId },
          data: { extraMetadata: newMeta },
        })
        return { message: '折叠状态已保存' }
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
