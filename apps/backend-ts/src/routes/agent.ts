// Agent 路由 —— 对应 Python app/api/v1/agent.py
import { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient, type ChatSession, type ChatMessage, type AgentToolExecution } from '@prisma/client'
import { z } from 'zod'
import { authGuard } from '../plugins/auth.js'
import { isOriginAllowed } from '../plugins/cors.js'
import { NotFoundError, BadRequestError } from '../plugins/error-handler.js'
import { genId } from '../utils/id.js'
import { env } from '../config/env.js'
import { DEFAULT_ALIAS, resolveModelAlias, toModelAlias } from '../config/models.js'
import { enforceRateLimit } from '../plugins/rate-limit.js'
import { recordSseDisconnect } from '../core/metrics.js'
import { buildSchema } from '../utils/zod-schema.js'
import {
  CreateAgentSessionRequestSchema,
  AgentChatRequestSchema,
  AgentFeedbackRequestSchema,
  AgentResumeRequestSchema,
  AgentAbortRequestSchema,
} from '../schemas/agent.js'
import { StopGenerationRequestSchema } from '../schemas/chat.js'
import {
  StreamContext,
  streamAgentCompletion,
  streamAgentResume,
  getPendingAgentState,
  mergePlanSteps,
  collectMetadataFromEvent,
  collectRunTimeline,
  startAgentRun,
  finishAgentRun,
  type AgentRunStatus,
} from '../core/agent-bridge.js'
import { checkInterruptTimeout, get_runner, resume_sync } from '@pioneering/modu-agent'
import { trackInterruptSession } from '../core/agent-scheduler.js'
import { checkQuota, recordUsage } from '../core/quota.js'
import { loadSessionHistoryByBudget } from '../core/context-budget.js'
import { applyUserMessageEdit } from '../core/message-edit.js'

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

// T5.5：agent_run → 响应（含事件时间轴，供回放执行轨迹）
function runToResponse(r: {
  id: string
  sessionId: string
  messageId: string | null
  agentMode: string
  status: string
  traceId: string
  events: unknown
  usage: unknown
  errorCode: string | null
  errorMessage: string | null
  startedAt: Date
  endedAt: Date | null
  durationMs: number | null
}) {
  return {
    id: r.id,
    sessionId: r.sessionId,
    messageId: r.messageId ?? null,
    agentMode: r.agentMode,
    status: r.status,
    traceId: r.traceId,
    events: Array.isArray(r.events) ? r.events : [],
    usage: r.usage ?? null,
    errorCode: r.errorCode ?? null,
    errorMessage: r.errorMessage ?? null,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.durationMs ?? null,
  }
}

/**
 * 续写合并：上一段已落库正文 + 本段新正文（保守去重）。
 *
 * HITL 暂停时半截消息已落库，resume 段正文需追加到同一条消息；三种情形
 * 都不产生重复内容，无法判断包含关系时按"前 + 后"拼接。
 */
export function mergeContinueContent(previous: string, next: string): string {
  const prev = previous ?? ''
  const cur = next ?? ''
  if (!prev) return cur
  if (!cur) return prev
  if (cur.startsWith(prev)) return cur
  if (prev.endsWith(cur)) return prev
  return `${prev}${cur}`
}

/**
 * 落库 metadata.plan_phase 判定：
 *   - 错误（流错误 / RUN_ERROR）→ 'error'
 *   - 暂停（HITL interrupt）    → 'executing'（进行中，前端据此恢复步骤面板）
 *   - P1-3：有步骤数据时按**步骤实际状态**推导 ——
 *     仍有 pending / running / retrying 步骤 → 'incomplete'。
 *     修复前恒定返回 'done'，导致"步骤 2~6 从未执行、step_1 还是 running"
 *     的任务在刷新后徽章显示"已完成"，而进度区显示"已完成 0/7 步"，
 *     两个视图结论相反（实测会话 sess_d7185e5c…）。
 *   - 其余（全部终态 / 无步骤数据）→ 'done'
 */
export function resolvePersistPlanPhase(
  ctx: StreamContext,
  steps?: Array<{ status?: string | null }>,
): 'executing' | 'error' | 'incomplete' | 'done' {
  if (ctx.hasError || ctx.planPhase === 'error') return 'error'
  if (ctx.paused) return 'executing'
  if (Array.isArray(steps) && steps.length > 0) {
    const unfinished = steps.some((s) => {
      const st = String(s?.status ?? '')
      return st === 'pending' || st === 'running' || st === 'retrying'
    })
    return unfinished ? 'incomplete' : 'done'
  }
  return 'done'
}

// 对应 Python: agent_completion 中的持久化逻辑
// 流结束后持久化 assistant 消息 + 工具执行记录 + plan 步骤终态，并更新会话计数
// P4: 新增 plan_steps 持久化（仅当本次产生过 plan 数据时），
//     并在 chat_messages.metadata 写入 plan_phase / plan_error 终态元数据。
//     注意：Prisma 字段名为 extraMetadata（映射到 DB 列 metadata），写入时使用 extraMetadata。
// 2026-10-14: 支持续写模式（continueMessageId）——HITL 暂停时半截消息已落库，
//     resume / 再次暂停 / 错误收尾时更新同一条消息，避免分片与刷新后内容丢失。
async function persistAssistantMessage(
  prisma: PrismaClient,
  opts: {
    sessionId: string
    userId: string
    ctx: StreamContext
    /**
     * 续写模式（2026-10-14）：更新该已存在的 assistant 消息，而非新建。
     * HITL 暂停时半截消息已落库（保证刷新可见）；resume / 再次暂停 / 错误时
     * 把本段正文追加到同一条，刷新前后端展示一致。
     */
    continueMessageId?: string | null
  },
): Promise<{ assistantMsg: ChatMessage; planStepsCount: number }> {
  const { sessionId, userId, ctx } = opts
  const continueId = opts.continueMessageId ?? null

  // 仅当本次产生过 plan 数据、或续写的是计划消息时才写入 metadata
  // （避免污染非 plan_execute 消息）
  const hasPlanData = ctx.planData.length > 0
  const isPlanMessage = hasPlanData || Boolean(continueId)

  // P1-3：先合并出步骤终态，metadata.plan_phase 才能按步骤实际状态推导
  // （此前恒为 'done'，与前端实时判定不一致）
  const mergedSteps = hasPlanData ? mergePlanSteps(ctx.planData, ctx.stepUpdates) : []

  const extraMetadata = isPlanMessage
    ? {
        plan_phase: resolvePersistPlanPhase(ctx, mergedSteps),
        plan_error: ctx.planError,
        // 暂停标记：完成后随 metadata 整体替换自动清除
        ...(ctx.paused ? { paused: true } : {}),
      }
    : undefined

  let assistantMsg: ChatMessage
  let assistantMsgId: string

  if (continueId) {
    const existing = await prisma.chatMessage.findUnique({ where: { id: continueId } })
    if (existing && existing.sessionId === sessionId && existing.role === 'assistant') {
      assistantMsgId = continueId
      const prevContent = existing.content ?? ''
      const prevBlocks = Array.isArray(existing.contentBlocks)
        ? (existing.contentBlocks as Record<string, any>[])
        : []
      assistantMsg = await prisma.chatMessage.update({
        where: { id: continueId },
        data: {
          content: mergeContinueContent(prevContent, ctx.answerContent),
          contentBlocks:
            ctx.contentBlocks.length > 0
              ? ([...prevBlocks, ...ctx.contentBlocks] as any)
              : (existing.contentBlocks ?? Prisma.JsonNull),
          extraMetadata: extraMetadata ?? undefined,
        },
      })
    } else {
      // 目标缺失/不匹配（越权或已删除）：降级为新建，保证内容不丢
      return persistAssistantMessage(prisma, {
        sessionId,
        userId,
        ctx,
        continueMessageId: null,
      })
    }
  } else {
    assistantMsgId = genId('msg_')
    assistantMsg = await prisma.chatMessage.create({
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
  }

  // ===== P4 新增：持久化 plan 步骤终态 =====
  // 续写模式先清空再重建（幂等）：resume 端点已把既有步骤注入 ctx.planData 基线，
  // mergePlanSteps(基线 + 本段 stepUpdates) 即完整终态，避免分片或状态回退。
  let planStepsCount = 0
  if (hasPlanData) {
    const merged = mergedSteps
    if (continueId) {
      await prisma.planStep.deleteMany({ where: { messageId: assistantMsgId } })
    }
    // P1-3：改为事务内批量写入 —— 此前逐条 create，任一条失败会留下
    // "消息已写、步骤只写了一半"的半截状态，且无回滚。
    //
    // 注意：不要写 duration_ms —— plan_steps 表由 Python init_db() 维护，
    // 该列是 PostgreSQL **生成列**（GENERATED ALWAYS AS），插入会报
    // 428C9 cannot insert a non-DEFAULT value into column "duration_ms"。
    // 耗时由数据库按 started_at / finished_at 自动计算。
    const rows = merged.map((s, i) => {
      const startedAt = s.started_at ? new Date(s.started_at) : null
      const finishedAt = s.finished_at ? new Date(s.finished_at) : null
      return {
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
        startedAt,
        finishedAt,
      }
    })
    if (rows.length > 0) {
      await prisma.$transaction(
        rows.map((data) => prisma.planStep.create({ data })),
      )
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

  // 更新会话计数（续写不重复计数；last_message_id 始终指向该消息）
  // （对应 Python: session.message_count += 1; session.last_message_id = ...）
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      ...(continueId ? {} : { messageCount: { increment: 1 } }),
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
            // P4：会话表存别名，真实模型 ID 由网关在调用时解析
            model: toModelAlias(dto.model) || DEFAULT_ALIAS,
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
        // 方案 B：携带 messageId 时为「编辑重发」——更新既有消息正文并截断其后消息，
        // 不新建用户消息、也不重复累加 messageCount（截断路径会重算真实计数）。
        let userMsg: { id: string }
        if (dto.messageId) {
          if (!dto.sessionId) {
            throw new BadRequestError('编辑重发必须提供 sessionId')
          }
          const applied = await applyUserMessageEdit(fastify.prisma, {
            sessionId,
            userId,
            messageId: dto.messageId,
            content: dto.message,
            truncateAfter: dto.truncateAfter ?? true,
          })
          userMsg = { id: applied.id }
        } else {
          userMsg = await fastify.prisma.chatMessage.create({
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
        }

        // 4. 加载会话历史（token 预算内选择，包含刚写入的用户消息）
        const history = await loadSessionHistoryByBudget(fastify.prisma, sessionId)

        // 使用后端配置的默认模型（对齐 Python: model=None 忽略会话 model）
        const systemPrompt = session?.systemPrompt ?? null

        // P4：分层限流（用户 / 模型），超限请求不触达上游
        enforceRateLimit(userId, dto.model)

        // T2.5：Agent 通道入口配额校验（超限抛 429）
        await checkQuota(fastify.prisma, userId)

        // T5.5：创建本次执行记录（running）；流结束后按 ctx 自动推导终态并收尾
        const runId = randomUUID()
        await startAgentRun(fastify.prisma, {
          runId,
          sessionId,
          userId,
          agentMode: dto.agentMode ?? 'react_agent',
        })

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
          let runMessageId: string | undefined

          // 注册运行（供 /completions/stop 中止本流），连接关闭时自动清理
          const stopController = new AbortController()
          const stopRunId = genId('arun_')
          agentRunningRuns.set(stopRunId, { sessionId, userId, controller: stopController })

          // P2-2：SSE 心跳。此前流内长时间无数据（LLM 思考/工具执行可达数十秒~数分钟），
          // 中间代理（nginx 等）可能按 idle timeout 断开连接，表现为"任务无缘无故中断"。
          // 每 15s 发一行注释帧（SSE 规范中的 comment，前端解析器会忽略非 data: 行）。
          const heartbeat = setInterval(() => {
            try {
              if (!reply.raw.writableEnded) {
                reply.raw.write(': ping\n\n')
              }
            } catch {
              // 连接已关闭，忽略
            }
          }, 15_000)

          let finishedNormally = false

          reply.raw.on('close', () => {
            clearInterval(heartbeat)
            // P4：流未走完就被关闭 → 计入断线率
            if (!finishedNormally) recordSseDisconnect('agent')
            agentRunningRuns.delete(stopRunId)
            // P2-2：客户端断开时中止上游（此前只删除注册表，Agent 仍在空跑、
            // 持续消耗模型配额并向已关闭的 socket 写入）。
            if (!stopController.signal.aborted) {
              fastify.log.info({ sessionId }, '[agent.completions] client disconnected, aborting upstream')
              stopController.abort()
            }
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
              // P0：模型透传。别名先解析；省略时由 agent-bridge 回退到默认模型。
              model: resolveModelAlias(dto.model) ?? null,
              systemPrompt,
              history,
              // P4: 透传 agentMode 以启用 Plan-Execute 图
              agentMode: dto.agentMode,
              // T2.3：stopController 信号透传到上游
              signal: stopController.signal,
              // T5.5：复用 handler 层 runId（= traceId）
              runId,
            })) {
              if (stopController.signal.aborted) {
                fastify.log.info({ sessionId }, '[agent.completions] stream aborted by /stop')
                // T2.4：标记中止原因（persist 守卫据此跳过）
                ctx.abortReason = 'user_cancel'
                break
              }
              sseCount++
              reply.raw.write(`data: ${eventDict.data}\n\n`)
            }
            finishedNormally = true
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

          // 5. 持久化 assistant 消息（2026-10-14 调整：暂停/错误/中止同样落库）
          //
          // 缺陷背景（用户报告"刷新后回复就不见了"）：原实现仅在"正常完成"时落库，
          // HITL 暂停 / 流错误 / 用户中止的 run 一律不落库——前端内存中可见的全部内容
          // 在刷新后丢失。现改为"有内容就落库"：
          //   - paused  → 落半截消息（metadata.paused=true / plan_phase='executing'），
          //                resume 完成后更新同一条（见 persist.continueMessageId）
          //   - 错误     → 落已生成内容（plan_phase='error' + plan_error）
          //   - 用户中止 → 落已生成内容
          const isPlanExecuteRun = ctx.planData.length > 0
          const hasPersistable =
            ctx.answerContent.length > 0 ||
            ctx.contentBlocks.length > 0 ||
            isPlanExecuteRun
          // 暂停（HITL）：仅 plan_execute 落半截消息（resume 接续同一条）；
          // 纯 ReAct（pro 模式）保持原语义——resume 完成后再落库，
          // 避免"前端续写目标在占位消息、DB 合并到暂停消息"的错位。
          // 错误 / 用户中止：所有模式都落库（原实现直接丢弃已生成内容）。
          const shouldPersist = !ctx.paused || isPlanExecuteRun
          if (hasPersistable && shouldPersist) {
            try {
              const { assistantMsg, planStepsCount } =
                await persistAssistantMessage(fastify.prisma, { sessionId, userId, ctx })
              runMessageId = assistantMsg.id
              if (planStepsCount > 0) {
                fastify.log.info(
                  { sessionId, planStepsCount },
                  '[agent.completions] persist.plan_steps',
                )
              }
              // T2.5：记录用量（仅正常完成；暂停/错误段待最终消息落库时计量）
              if (!ctx.paused && !streamError && !ctx.abortReason) {
                await recordUsage(fastify.prisma, {
                  userId,
                  sessionId,
                  messageId: assistantMsg.id,
                  model: session?.model ?? env.LLM_DEFAULT_MODEL,
                  promptText: dto.message,
                  completionText: ctx.answerContent,
                })
              }
            } catch (e: any) {
              // 持久化失败不影响已发送的 SSE 流
              fastify.log.error({ err: e, sessionId }, 'Failed to persist agent assistant message')
            }
          } else {
            fastify.log.info(
              { sessionId, paused: ctx.paused, streamError },
              '[agent.completions] skip_persist.empty',
            )
          }
          if (ctx.paused) {
            // T2.2：真暂停（等待用户答复）才注册 TTL sweep；HITL_ABORTED 不跟踪
            if (ctx.runPaused) trackInterruptSession(sessionId)
          }

          // T5.5：收尾 agent_run（自动推导 completed/paused/cancelled/error）。
          // 隔离收尾异常，不影响已写出的 SSE 与连接关闭。
          try {
            await finishAgentRun(fastify.prisma, { runId, ctx, messageId: runMessageId })
          } catch (e: any) {
            fastify.log.error({ err: e, runId }, 'Failed to finish agent run')
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
          // P0：与流式路径一致，支持 per-request 模型覆盖
          model: resolveModelAlias(dto.model) ?? null,
          systemPrompt,
          history,
          // P4: 透传 agentMode 以启用 Plan-Execute 图
          agentMode: dto.agentMode,
          // T5.5：复用 handler 层 runId
          runId,
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

        // T5.5：收尾 agent_run
        try {
          await finishAgentRun(fastify.prisma, { runId, ctx, messageId: assistantMsg.id })
        } catch (e: any) {
          fastify.log.error({ err: e, runId }, 'Failed to finish agent run')
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

        // T2.5：resume 入口同样校验配额
        await checkQuota(fastify.prisma, userId)

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
        let resumeMessageId: string | undefined

        // 2026-10-14：续写定位——找到暂停时落库的半截 assistant 消息与其 plan 基线。
        // completions 暂停时已落库半截消息（metadata.paused=true）；resume 段正文
        // 追加到同一条，避免刷新前（内存一条）后（DB 两条）展示不一致。
        let continueMessageId: string | null = null
        try {
          const pausedRun = await fastify.prisma.agentRun.findFirst({
            where: { sessionId: dto.sessionId, userId, status: 'paused' },
            orderBy: { startedAt: 'desc' },
            select: { messageId: true },
          })
          continueMessageId = pausedRun?.messageId ?? null
          if (!continueMessageId) {
            // 兜底：agent_runs 未关联 messageId（历史数据）时按暂停标记查找最近一条
            const pausedMsg = await fastify.prisma.chatMessage.findFirst({
              where: {
                sessionId: dto.sessionId,
                userId,
                role: 'assistant',
                extraMetadata: { path: ['paused'], equals: true },
              },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            })
            continueMessageId = pausedMsg?.id ?? null
          }
          if (continueMessageId) {
            // plan 基线：resume 段只含 step_update（不重发全量 plan），
            // 以既有 plan_steps 作为 ctx.planData 基线，mergePlanSteps 后即完整终态。
            const steps = await fastify.prisma.planStep.findMany({
              where: { messageId: continueMessageId },
              orderBy: { stepIndex: 'asc' },
            })
            // P1-3 数据丢失修复：基线必须带上 result / error / 时间戳。
            // 此前只映射 step_id/title/description/status —— 而续写落库是
            // `deleteMany + create`（以 merged 为准重建），结果就是：
            // resume 之后所有已完成步骤的产物（result）与时间信息被清空
            // （实测：5 步全部 result=""、started_at/finished_at 全 null）。
            ctx.planData = steps.map((s) => ({
              step_id: s.stepId,
              title: s.title,
              description: s.description ?? '',
              status: s.status,
              ...(s.result != null ? { result: s.result } : {}),
              ...(s.error != null ? { error: s.error } : {}),
              ...(s.startedAt ? { started_at: s.startedAt.getTime() } : {}),
              ...(s.finishedAt ? { finished_at: s.finishedAt.getTime() } : {}),
              ...(Array.isArray(s.dependsOn)
                ? { depends_on: s.dependsOn as string[] }
                : {}),
            }))
          }
        } catch (e: any) {
          fastify.log.warn(
            { err: e, sessionId: dto.sessionId },
            '[agent.resume] continue-locate failed; fallback to new message',
          )
        }

        // T2.3：注册 stopController（供 /completions/stop 中止 resume 流）
        const resumeStopController = new AbortController()
        const resumeRunId = genId('arun_')
        agentRunningRuns.set(resumeRunId, {
          sessionId: dto.sessionId,
          userId,
          controller: resumeStopController,
        })
        reply.raw.on('close', () => {
          agentRunningRuns.delete(resumeRunId)
        })

        try {
          for await (const eventDict of streamAgentResume({
            sessionId: dto.sessionId,
            userId,
            approved: dto.approved,
            feedback: dto.feedback ?? '',
            modifiedArgs: dto.modifiedArgs ?? undefined,
            // 澄清回答透传给 clarify 节点（kind='clarifying' | 'choice'）
            answer: dto.answer ?? undefined,
            answerId: dto.answerId ?? undefined,
            signal: resumeStopController.signal,
            // 与 streamAgentCompletion 同构：resume 段正文经 ctx 回填后落库
            ctx,
          })) {
            if (resumeStopController.signal.aborted) {
              ctx.abortReason = 'user_cancel'
              break
            }
            sseCount++
            reply.raw.write(`data: ${eventDict.data}\n\n`)
            // 复用 collectMetadataFromEvent 收集元数据（RUN_PAUSED 会再次置 ctx.paused）
            collectMetadataFromEvent(eventDict, ctx)
            // T5.5：收集 resume 段事件时间轴
            collectRunTimeline(eventDict, ctx)
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

        // 2026-10-14 调整：resume 段结束（完成/再次暂停/错误/中止）统一落库——
        // 续写暂停时已落库的同一条消息（continueMessageId），有内容即落，
        // 保证"刷新后内容不丢"（原实现仅在正常完成时落库，错误/再次暂停会丢内容）。
        const hasResumePersistable =
          ctx.answerContent.length > 0 ||
          ctx.contentBlocks.length > 0 ||
          ctx.planData.length > 0
        if (hasResumePersistable) {
          try {
            const { assistantMsg } = await persistAssistantMessage(fastify.prisma, {
              sessionId: dto.sessionId,
              userId,
              ctx,
              continueMessageId,
            })
            resumeMessageId = assistantMsg.id
            // T2.5：记录用量（仅正常完成；暂停/错误段随最终消息计量）
            if (!streamError && !ctx.paused && !ctx.abortReason) {
              await recordUsage(fastify.prisma, {
                userId,
                sessionId: dto.sessionId,
                messageId: assistantMsg.id,
                model: env.LLM_DEFAULT_MODEL,
                promptText: dto.feedback ?? '',
                completionText: ctx.answerContent,
              })
            }
          } catch (e: any) {
            fastify.log.error({ err: e, sessionId: dto.sessionId }, 'Failed to persist resume assistant message')
          }
        } else if (ctx.paused) {
          // 再次被 interrupt 暂停且本段无内容（罕见）→ 跳过，前端继续等待下一轮答复
          fastify.log.info(
            { sessionId: dto.sessionId },
            '[agent.resume] skip_persist.re_paused',
          )
        }

        // T5.5：若带 runId，按 resume 结果收尾原 run（合并首次 + resume 事件、seq 延续）
        if (dto.runId) {
          try {
            const existing = await fastify.prisma.agentRun.findFirst({
              where: { id: dto.runId, userId },
            })
            if (existing) {
              const resumeStatus: AgentRunStatus = streamError
                ? 'error'
                : ctx.paused
                  ? 'paused'
                  : ctx.abortReason
                    ? 'cancelled'
                    : 'completed'
              const baseEvents = Array.isArray(existing.events)
                ? (existing.events as Record<string, any>[])
                : []
              await finishAgentRun(fastify.prisma, {
                runId: dto.runId,
                ctx,
                status: resumeStatus,
                messageId: resumeMessageId,
                baseEvents,
              })
            }
          } catch (e: any) {
            fastify.log.error(
              { err: e, runId: dto.runId },
              'Failed to finish resumed agent run',
            )
          }
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

        // T5.5：拒绝后把该会话下属于当前用户的 paused run 收尾为 cancelled
        try {
          await fastify.prisma.agentRun.updateMany({
            where: { sessionId: dto.sessionId, userId, status: 'paused' },
            data: { status: 'cancelled', endedAt: new Date() },
          })
        } catch (e: any) {
          fastify.log.warn(
            { err: e },
            '[agent.abort] failed to cancel paused runs',
          )
        }

        fastify.log.info(
          { sessionId: dto.sessionId, reason: dto.reason},
          '[agent.abort] interrupted run rejected',
        )
        return { message: 'aborted', aborted: true }
      })

      // ========== Run 执行记录（T5.5）==========

      // GET /agent/runs —— 列出当前用户的 run（可按 sessionId 过滤）
      app.get('/runs', buildSchema({
        querystring: z.object({
          sessionId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
        tags: ['agent'],
        summary: '列出 Agent 执行记录',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const q = req.query as { sessionId?: string; limit?: number }
        const runs = await fastify.prisma.agentRun.findMany({
          where: {
            userId: req.user.id,
            ...(q.sessionId ? { sessionId: q.sessionId } : {}),
          },
          orderBy: { startedAt: 'desc' },
          take: q.limit ?? 50,
        })
        return { runs: runs.map(runToResponse) }
      })

      // GET /agent/runs/:runId —— 返回单个 run 元数据与事件时间轴（回放执行轨迹）
      app.get('/runs/:runId', buildSchema({
        params: z.object({ runId: z.string() }),
        tags: ['agent'],
        summary: '获取 Agent 执行记录与事件时间轴',
        security: [{ BearerAuth: [] }],
      }), async (req) => {
        const { runId } = req.params as { runId: string }
        const run = await fastify.prisma.agentRun.findFirst({
          where: { id: runId, userId: req.user.id },
        })
        if (!run) throw new NotFoundError('执行记录不存在')
        return runToResponse(run)
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
