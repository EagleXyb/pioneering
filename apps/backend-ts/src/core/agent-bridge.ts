// 对应 Python: app/core/agent_bridge.py
// AG-UI 流式 Agent 对话桥接层。
//
// 在流式传输过程中收集元数据（StreamContext），流结束后供路由层持久化到 DB。
// 通过 AGUIStreamAdapter.transform_langgraph_events 将 LangGraph stream 事件
// 转换为 AG-UI 协议事件（{"data": "..."} dict）。
import { randomUUID } from 'crypto'

import {
  create_agent,
  get_runner,
  stream_response,
  resume_stream,
  get_interrupt_state,
  getDomainAdapter,
  AGUIStreamAdapter,
  AGUIEncoder,
  AGUIEventType,
} from '@pioneering/modu-agent'
import { env } from '../config/env.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[agent-bridge] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[agent-bridge] ${msg}`, ...args),
}

// T5.3：模式 → 默认领域域名（宿主侧约定）。
// 仅当对应场景包已激活（域名已注册）时才注入 configurable.domain，
// 未激活时保持空 → 继续走 get_runner 缓存图，不破坏默认路径与 T2.6 缓存。
const MODE_DOMAIN: Record<string, string> = {
  react_agent: 'research_writer',
  plan_execute: 'task_planner',
}

// ============================================================
// StreamContext: 元数据收集（对应 Python StreamContext dataclass）
// ============================================================
export class StreamContext {
  answerContent = ''
  contentBlocks: Record<string, any>[] = []
  toolExecutions: Record<string, any>[] = []
  promptTokens = 0
  completionTokens = 0
  latencyMs = 0
  hasError = false
  errorInfo: Record<string, string> = {}
  startTime = Date.now()
  // P4: Plan-Execute 元数据，供持久化与状态恢复
  planData: Record<string, any>[] = []
  stepUpdates: Record<string, any>[] = []
  // P4: Plan 终态元数据（供 persistAssistantMessage 写入 chat_messages.metadata）
  planPhase: 'done' | 'error' | null = null
  planError: string | null = null
  // HITL: 本次 run 是否被 interrupt() 暂停（阶段零 D2——暂停的 run 不持久化空/半截消息）
  paused = false
  // T2.2：仅 RUN_PAUSED（等待答复）为 true；HITL_ABORTED 不跟踪 TTL
  runPaused = false
  // T2.3：取消信号，透传给 LangGraph stream（上游真正中止）
  signal: AbortSignal | null = null
  // T2.4：中止原因（user_cancel / timeout / reject）——有值时不持久化半截消息
  abortReason: 'user_cancel' | 'timeout' | 'reject' | null = null

  // T5.5：本次 run 的事件时间轴（结构性里程碑，折叠流式分片），随 agent_run 落库
  runEvents: Record<string, any>[] = []

  finish(): void {
    this.latencyMs = Date.now() - this.startTime
  }
}

// ============================================================
// streamAgentCompletion（对应 Python stream_agent_completion）
// ============================================================

export interface StreamAgentCompletionOptions {
  message: string
  sessionId: string
  userId: string
  ctx: StreamContext
  model?: string | null
  systemPrompt?: string | null
  history?: { role: string; content: string }[]
  // P4: 支持 per-request 切换 Plan-Execute 图
  agentMode?: 'react_agent' | 'plan_execute'
  // T2.3：取消信号（透传至 LangGraph）
  signal?: AbortSignal | null
  // T5.5：显式 runId（= agent_runs.id / traceId）；省略时内部生成
  runId?: string
}

/**
 * Agent ReAct 流式对话，输出 AG-UI 标准 SSE 事件 dict。
 *
 * 对应 Python: stream_agent_completion。
 * 差异：TS 的 create_agent 是 async（MCP 工具发现异步），需 await。
 * TS 无需 _init_moduagent()（modu-agent 通过 runtime-config 自初始化）。
 *
 * P4: agentMode='plan_execute' 时通过 configurable.plan_execute_enabled=true
 * 启用 Plan-Execute 图（planner / step_dispatch / step_finalize 节点）。
 *
 * @yields Record<string, string> —— {"data": "..."} 格式，兼容 SSE 输出
 */
export async function* streamAgentCompletion(
  opts: StreamAgentCompletionOptions,
): AsyncGenerator<Record<string, string>> {
  const { message, sessionId, userId, ctx, model, systemPrompt, history, agentMode } = opts

  // 构建 configurable（支持 model / system_prompt / plan_execute_enabled 覆盖）
  const configurable: Record<string, any> = {}
  if (model && model !== env.LLM_DEFAULT_MODEL) {
    configurable.model = model
  }
  if (systemPrompt) {
    configurable.system_prompt = systemPrompt
  }
  if (agentMode === 'plan_execute') {
    configurable.plan_execute_enabled = true
  }

  // T5.3：场景包已激活时按模式注入领域（供 PromptComposer 的 domain 层）。
  // 域名未注册（无激活包）则跳过，保持 get_runner 缓存路径。
  const domainName = MODE_DOMAIN[agentMode ?? 'react_agent']
  if (domainName && getDomainAdapter(domainName) !== null) {
    configurable.domain = domainName
  }

  // T2.6：图实例优先走 get_runner 缓存（避免每请求重建）。
  // 仅当存在 build 期覆盖（model/system_prompt）时才 create_agent——
  // 这两项在 build 时读取，无法经运行时 config 注入。
  const hasBuildOverrides = Object.keys(configurable).length > 0
  const graph = hasBuildOverrides
    ? await create_agent({ configurable })
    : await get_runner()

  // 注入会话历史到 input_data
  const inputData: Record<string, any> = { input_type: 'text', prompt: message }
  if (history) {
    inputData.history = history
  }

  const traceId = opts.runId ?? randomUUID()
  const adapter = new AGUIStreamAdapter(traceId)

  logger.info(
    'stream.start trace_id=%s session_id=%s agentMode=%s configurable=%j',
    traceId, sessionId, agentMode ?? 'react_agent', configurable,
  )

  let eventCount = 0
  try {
    // P4: 将 configurable 中的 plan_execute_enabled 透传到 stream_response，
    // 使运行时路由函数（routeAfterMemoryQuery）能通过 config.configurable 读取 per-request 配置
    const extraConfigurable: Record<string, any> = {}
    if (agentMode === 'plan_execute') {
      extraConfigurable.plan_execute_enabled = true
    }

    for await (const eventDict of adapter.transform_langgraph_events(
      stream_response(
        graph,
        userId,
        sessionId,
        inputData,
        traceId,
        null,
        extraConfigurable,
        opts.signal ?? null,
      ),
    )) {
      eventCount++
      const dataStr = eventDict.data ?? ''
      let aguiType = ''
      try { aguiType = dataStr ? (JSON.parse(dataStr).type ?? '') : '' } catch {}
      logger.info(
        'stream.yield[%d] agui_type=%s data_len=%d',
        eventCount, aguiType, dataStr.length,
      )
      yield eventDict
      collectMetadataFromEvent(eventDict, ctx)
      collectRunTimeline(eventDict, ctx)
    }
  } catch (e: any) {
    logger.error('Agent stream error: %s', String(e))
    // T2.4：信号中止时记录原因，持久化据此跳过（不发 RUN_ERROR，流已被调用方 break）
    if (e?.name === 'AbortError') {
      ctx.abortReason = 'user_cancel'
      return
    }
    ctx.hasError = true
    ctx.errorInfo = { code: 'AGENT_ERROR', message: String(e) }
    const errEventDict = AGUIEncoder.toEventDict(AGUIEventType.RUN_ERROR, {
      code: 'AGENT_ERROR',
      message: String(e),
    })
    yield errEventDict
    // RUN_ERROR 在循环外发出，手动补进时间轴
    collectRunTimeline(errEventDict, ctx)
  }

  logger.info(
    'stream.end total_events=%d answer_len=%d tool_count=%d plan_data=%d step_updates=%d',
    eventCount, ctx.answerContent.length, ctx.toolExecutions.length,
    ctx.planData.length, ctx.stepUpdates.length,
  )

  // 流结束，填充元数据
  ctx.answerContent = adapter.collected_text
  ctx.finish()

  // 从 adapter 的 tool_call_records 构建 tool_executions
  for (const rec of adapter.tool_call_records) {
    const resultJson = JSON.stringify(rec.result)
    ctx.toolExecutions.push({
      executionId: randomUUID(),
      toolName: rec.tool_name,
      inputParams: rec.params,
      outputResult: resultJson,
      outputSummary: resultJson.slice(0, 500),
      status: rec.result?.status ?? 'unknown',
    })
  }
}

// ============================================================
// streamAgentResume（HITL 阶段一 1.3）——恢复被 interrupt 暂停的 run
// ============================================================

export interface ResumeAgentOptions {
  sessionId: string
  userId: string
  approved: boolean
  feedback?: string
  /** 改参批准：按 tool_call_id 覆盖原参数（v1.2 §4.3 建议3） */
  modifiedArgs?: Record<string, Record<string, any>>
  /** 需求澄清回答：自由文本（kind='clarifying'） */
  answer?: string
  /** 需求澄清回答：多选选项 id（kind='choice'） */
  answerId?: string
  traceId?: string
  // T2.3：取消信号
  signal?: AbortSignal | null
  /**
   * 流式元数据收集器（必填）。
   * 与 streamAgentCompletion 同构：resume 段事件同样要经路由层 collectMetadataFromEvent 累积，
   * 且本函数必须在流结束时把 adapter.collected_text 回填到 ctx.answerContent。
   * 否则 persistAssistantMessage 落库的 assistant 消息 content 为空串，
   * 表现为「流式能看到回答，但刷新后回答消失」。
   */
  ctx: StreamContext
}

/**
 * 恢复被 interrupt() 暂停的 Agent run，产出与 streamAgentCompletion 一致的 AG-UI SSE dict。
 *
 * 包装 runner.resume_stream（内部 `new Command({ resume })` 按 thread_id=sessionId 续跑），
 * 并经 AGUIStreamAdapter.transform_langgraph_events 转 AG-UI 事件。
 * 复用共享 MemorySaver 单例（factory.build_checkpointer），保证能读取中断时的 checkpoint。
 */
export async function* streamAgentResume(
  opts: ResumeAgentOptions,
): AsyncGenerator<Record<string, string>> {
  const { sessionId, userId, approved, feedback, modifiedArgs, answer, answerId, traceId, signal, ctx } =
    opts
  const trace = traceId ?? randomUUID()
  // T2.6：resume 复用缓存图（checkpointer 共享，能读取中断 checkpoint）
  const graph = await get_runner()

  const adapter = new AGUIStreamAdapter(trace)
  logger.info(
    'resume.start trace_id=%s session_id=%s approved=%s modified_args=%d answer=%s',
    trace, sessionId, approved, Object.keys(modifiedArgs ?? {}).length, answer ? 'yes' : 'no',
  )

  for await (const eventDict of adapter.transform_langgraph_events(
    resume_stream(
      graph,
      sessionId,
      approved,
      feedback ?? '',
      trace,
      {
        modifiedArgs,
        answer,
        answerId,
      },
      signal ?? null,
    ),
  )) {
    yield eventDict
  }

  // 与 streamAgentCompletion 对齐：把本段正文与耗时回填 ctx，供路由层落库
  // （缺这一步会让 assistant 消息 content 落库为空串，刷新后回答消失）。
  ctx.answerContent = adapter.collected_text
  ctx.finish()
}

// ============================================================
// getPendingAgentState（HITL 阶段一 1.3）——查询 pending interrupt 状态
// ============================================================

/**
 * 查询指定 session 的 HITL 暂停状态（前端进页/重连恢复用）。
 * 包装 runner.get_interrupt_state。userId 由调用方校验归属后再传入。
 */
export async function getPendingAgentState(
  sessionId: string,
  userId: string,
): Promise<Record<string, any> | null> {
  const graph = await create_agent()
  const state = await get_interrupt_state(graph, sessionId)
  if (state === null) {
    return null
  }
  // 仅返回归属当前用户的暂停项（IDOR 防护：归属校验在路由层已完成，此处再兜底一次）
  if (state['user_id'] && state['user_id'] !== userId) {
    return null
  }
  return {
    session_id: state['session_id'] ?? sessionId,
    // kind：前端据此选择弹窗类型（工具审批 / 澄清追问 / 多选），避免靠布尔值猜测
    kind: state['kind'] ?? 'tool_confirm',
    message: state['message'] ?? '',
    question: state['question'] ?? undefined,
    options: state['options'] ?? undefined,
    // plan_confirm 预留：方案确认门的产物文件列表（spec.md/tasks.md 等），无该字段时为 undefined
    artifacts: state['artifacts'] ?? undefined,
    next_nodes: state['next_nodes'] ?? [],
    pending_tool_calls: state['pending_tool_calls'] ?? [],
    tool_requires_approval: state['tool_requires_approval'] ?? false,
    trace_id: state['trace_id'] ?? '',
    user_id: state['user_id'] ?? '',
    created_at: state['created_at'] ?? null,
  }
}

// ============================================================
// T5.5：collectRunTimeline —— 构建 run 事件时间轴
// ============================================================

// 折叠的流式分片事件（不逐条进时间轴，避免被大量 delta 淹没）
const TIMELINE_SKIP_EVENTS = new Set([
  'TEXT_MESSAGE_CONTENT',
  'THINKING_TEXT_MESSAGE_CONTENT',
  'TOOL_CALL_ARGS',
])
const TIMELINE_MAX_EVENTS = 300
// 提取到时间轴的短标量字段白名单
const TIMELINE_SCALAR_KEYS = [
  'role',
  'toolCallId',
  'toolCallName',
  'phase',
  'status',
  'code',
  'reason',
  'message',
]

function safeJsonStringify(v: any): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function truncateTimelineValue(v: any, max: number = 300): any {
  const s = typeof v === 'string' ? v : safeJsonStringify(v)
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/**
 * 从单个 AG-UI 事件提取结构性里程碑，追加到 ctx.runEvents。
 * 流式分片（CONTENT delta）被折叠；结构化负载（工具参数/结果/计划）截断保留。
 */
export function collectRunTimeline(
  eventDict: Record<string, string>,
  ctx: StreamContext,
): void {
  if (ctx.runEvents.length >= TIMELINE_MAX_EVENTS) return
  const dataStr = eventDict.data ?? ''
  if (!dataStr) return

  let data: Record<string, any>
  try {
    data = JSON.parse(dataStr)
  } catch {
    return
  }
  const type = data.type ?? ''
  if (!type || TIMELINE_SKIP_EVENTS.has(type)) return

  const ev: Record<string, any> = {
    seq: ctx.runEvents.length + 1,
    type,
    ts: Date.now(),
  }
  for (const k of TIMELINE_SCALAR_KEYS) {
    const v = data[k]
    if (v != null && typeof v !== 'object') {
      ev[k] = truncateTimelineValue(String(v), 200)
    }
  }
  if (data.toolCallArgs != null) {
    ev.toolCallArgs = truncateTimelineValue(data.toolCallArgs)
  }
  if (data.args != null && type === 'TOOL_CALL_START') {
    ev.args = truncateTimelineValue(data.args)
  }
  if (
    data.content != null &&
    (type === 'TOOL_CALL_RESULT' || type === 'STEP_FINISHED')
  ) {
    ev.content = truncateTimelineValue(data.content)
  }
  if (Array.isArray(data.plan)) ev.planCount = data.plan.length

  ctx.runEvents.push(ev)
}

// ============================================================
// collectMetadataFromEvent（对应 Python _collect_metadata_from_event）
// ============================================================

/**
 * 从 AG-UI 事件中提取元数据，填充 StreamContext。
 * 对应 Python: _collect_metadata_from_event
 */
export function collectMetadataFromEvent(
  eventDict: Record<string, string>,
  ctx: StreamContext,
): void {
  const dataStr = eventDict.data ?? ''
  if (!dataStr) {
    return
  }

  let data: Record<string, any>
  try {
    data = JSON.parse(dataStr)
  } catch {
    return
  }

  const eventType = data.type ?? ''

  if (eventType === 'THINKING_START') {
    ctx.contentBlocks.push({ type: 'thinking', status: 'running', summary: '' })
  } else if (eventType === 'THINKING_TEXT_MESSAGE_CONTENT') {
    for (const b of ctx.contentBlocks) {
      if (b.type === 'thinking' && b.status === 'running') {
        b.summary += data.delta ?? ''
        break
      }
    }
  } else if (eventType === 'THINKING_END') {
    for (const b of ctx.contentBlocks) {
      if (b.type === 'thinking' && b.status === 'running') {
        b.status = 'success'
        break
      }
    }
  } else if (eventType === 'TOOL_CALL_START') {
    ctx.contentBlocks.push({
      type: 'tool_call',
      status: 'running',
      toolName: data.toolCallName ?? '',
      executionId: data.toolCallId ?? '',
    })
  } else if (eventType === 'TOOL_CALL_RESULT') {
    for (let i = ctx.contentBlocks.length - 1; i >= 0; i--) {
      const b = ctx.contentBlocks[i]
      if (b.type === 'tool_call' && b.executionId === data.toolCallId) {
        b.status = 'success'
        break
      }
    }
    ctx.contentBlocks.push({
      type: 'tool_result',
      status: 'success',
      toolName: data.toolCallName ?? '',
      executionId: data.toolCallId ?? '',
      summary: (data.content ?? '').slice(0, 200),
    })
  } else if (eventType === 'TEXT_MESSAGE_CONTENT') {
    if (!ctx.contentBlocks.some((b) => b.type === 'text_stream')) {
      ctx.contentBlocks.push({ type: 'text_stream', status: 'running', text: '' })
    }
    for (const b of ctx.contentBlocks) {
      if (b.type === 'text_stream' && b.status === 'running') {
        b.text += data.delta ?? ''
        break
      }
    }
  } else if (eventType === 'TEXT_MESSAGE_END') {
    for (const b of ctx.contentBlocks) {
      if (b.type === 'text_stream' && b.status === 'running') {
        b.status = 'success'
        break
      }
    }
  } else if (eventType === 'STATE_DELTA') {
    // P4: 收集 Plan-Execute 元数据，供持久化与前端状态恢复
    const phase = data.phase ?? ''
    if (phase === 'plan' && Array.isArray(data.plan)) {
      ctx.planData = data.plan
    } else if (phase === 'execute' && data.step_update) {
      ctx.stepUpdates.push(data.step_update)
    }
  } else if (eventType === 'RUN_FINISHED') {
    // P4: Plan 终态阶段标记（供 persistAssistantMessage 写入 metadata.plan_phase）
    ctx.planPhase = 'done'
  } else if (eventType === 'RUN_PAUSED') {
    // HITL（阶段零 D3）：run 被 interrupt 暂停——标记 ctx，路由层据此跳过空消息持久化
    ctx.paused = true
    ctx.runPaused = true
  } else if (eventType === 'HITL_ABORTED') {
    // HITL：超时/用户取消后收尾——同样视为非正常完成，不持久化空消息
    ctx.paused = true
  } else if (eventType === 'RUN_ERROR') {
    ctx.hasError = true
    ctx.errorInfo = { code: data.code ?? '', message: data.message ?? '' }
    // P4: Plan 终态阶段标记（error 时同时记录错误信息）
    ctx.planPhase = 'error'
    ctx.planError = data.message ?? null
  }
}

// ============================================================
// mergePlanSteps: 将 planData + stepUpdates 合并为步骤终态
// ============================================================

export interface MergedPlanStep {
  step_id: string
  title: string
  description: string
  depends_on?: string[]
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  result?: string
  error?: string
  started_at?: number   // ms 时间戳
  finished_at?: number  // ms 时间戳
}

/**
 * 将 StreamContext 收集的 planData（最后一次 plan 快照）与
 * stepUpdates（全量步骤更新日志，跨 replan 累积）合并为步骤终态。
 *
 * 合并规则：
 *   1. 以最新 plan 快照为骨架（status 初始 pending）
 *   2. 按顺序应用 step_update（同 id 后写覆盖前写）
 *   3. 跳过不在最新 plan 中的 step_id（replan 前已失效的步骤不持久化）
 *   4. 保序输出（planData 顺序即为 rootIds 顺序）
 */
export function mergePlanSteps(
  planData: Record<string, any>[],
  stepUpdates: Record<string, any>[],
): MergedPlanStep[] {
  const map = new Map<string, MergedPlanStep>()
  for (const s of planData) {
    const id = s.step_id ?? s.id ?? ''
    if (!id) continue
    map.set(id, {
      step_id: id,
      title: s.title ?? '',
      description: s.description ?? '',
      depends_on: s.depends_on,
      status: s.status ?? 'pending',
    })
  }
  for (const u of stepUpdates) {
    const id = u.id ?? ''
    const step = map.get(id)
    if (!step) continue  // 跳过 replan 前已失效的 step_id
    if (u.status) step.status = u.status
    if (u.result !== undefined) step.result = u.result
    if (u.error !== undefined) step.error = u.error
    if (u.started_at !== undefined) step.started_at = u.started_at
    if (u.finished_at !== undefined) step.finished_at = u.finished_at
  }
  return Array.from(map.values())
}

// ============================================================
// T5.5：agent_run 落库原语（start / finish）
// ============================================================

/** run 终态：running / completed / error / cancelled / paused */
export type AgentRunStatus = 'running' | 'completed' | 'error' | 'cancelled' | 'paused'

/** 创建一条 running 的 agent_run（prisma 由调用方注入）。 */
export async function startAgentRun(
  prisma: any,
  args: {
    runId: string
    sessionId: string
    userId: string
    agentMode?: string | null
  },
): Promise<void> {
  await prisma.agentRun.create({
    data: {
      id: args.runId,
      sessionId: args.sessionId,
      userId: args.userId,
      agentMode: args.agentMode ?? 'react_agent',
      status: 'running',
      traceId: args.runId,
      startedAt: new Date(),
    },
  })
}

/**
 * 按 StreamContext 收尾 agent_run。
 * 不传 status 时自动推导：error → error，runPaused/paused → paused，
 * abortReason → cancelled，否则 completed。
 */
export async function finishAgentRun(
  prisma: any,
  args: {
    runId: string
    ctx: StreamContext
    status?: AgentRunStatus
    // 关联本次执行落库的 assistant 消息（completions persist 后传入）
    messageId?: string
    // resume 场景：首次 /completions 的已有事件，提供则与本次事件合并、seq 延续
    baseEvents?: Record<string, any>[]
  },
): Promise<void> {
  const { ctx } = args
  let status: AgentRunStatus
  let errorCode: string | null = null
  let errorMessage: string | null = null

  if (args.status) {
    status = args.status
  } else if (ctx.hasError) {
    status = 'error'
  } else if (ctx.runPaused || ctx.paused) {
    status = 'paused'
  } else if (ctx.abortReason) {
    status = 'cancelled'
  } else {
    status = 'completed'
  }

  if (status === 'error') {
    errorCode = ctx.errorInfo.code || 'AGENT_ERROR'
    errorMessage = ctx.errorInfo.message || ''
  }

  // resume：baseEvents 与本次事件合并，seq 延续；否则只用本次事件
  let mergedEvents: Record<string, any>[] = ctx.runEvents
  if (args.baseEvents && args.baseEvents.length > 0) {
    const baseLen = args.baseEvents.length
    mergedEvents = [
      ...args.baseEvents,
      ...ctx.runEvents.map((e, i) => ({ ...e, seq: baseLen + i + 1 })),
    ]
  }

  const data: Record<string, any> = {
    status,
    events: mergedEvents,
  }
  // paused：run 尚未结束，保留 endedAt 为空，等待 resume 收尾
  if (status !== 'paused') {
    data.endedAt = new Date()
    data.durationMs = ctx.latencyMs
    data.usage = {
      promptTokens: ctx.promptTokens,
      completionTokens: ctx.completionTokens,
    }
  }
  if (errorCode) data.errorCode = errorCode
  if (errorMessage) data.errorMessage = errorMessage
  if (args.messageId) data.messageId = args.messageId

  await prisma.agentRun.update({ where: { id: args.runId }, data })
}


