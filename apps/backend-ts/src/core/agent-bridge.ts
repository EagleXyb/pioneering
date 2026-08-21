// 对应 Python: app/core/agent_bridge.py
// AG-UI 流式 Agent 对话桥接层。
//
// 在流式传输过程中收集元数据（StreamContext），流结束后供路由层持久化到 DB。
// 通过 AGUIStreamAdapter.transform_langgraph_events 将 LangGraph stream 事件
// 转换为 AG-UI 协议事件（{"data": "..."} dict）。
import { randomUUID } from 'crypto'

import {
  create_agent,
  stream_response,
  resume_stream,
  get_interrupt_state,
  AGUIStreamAdapter,
  AGUIEncoder,
  AGUIEventType,
} from '@pioneering/modu-agent'
import { env } from '../config/env.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[agent-bridge] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[agent-bridge] ${msg}`, ...args),
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

  // 有覆盖项时传 configurable，否则无参调用（走全局配置，行为不变）
  const graph = Object.keys(configurable).length > 0
    ? await create_agent({ configurable })
    : await create_agent()

  // 注入会话历史到 input_data
  const inputData: Record<string, any> = { input_type: 'text', prompt: message }
  if (history) {
    inputData.history = history
  }

  const traceId = randomUUID()
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
      stream_response(graph, userId, sessionId, inputData, traceId, null, extraConfigurable),
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
    }
  } catch (e: any) {
    logger.error('Agent stream error: %s', String(e))
    ctx.hasError = true
    ctx.errorInfo = { code: 'AGENT_ERROR', message: String(e) }
    yield AGUIEncoder.toEventDict(AGUIEventType.RUN_ERROR, {
      code: 'AGENT_ERROR',
      message: String(e),
    })
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
  traceId?: string
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
  const { sessionId, userId, approved, feedback, modifiedArgs, traceId } = opts
  const trace = traceId ?? randomUUID()
  const graph = await create_agent()

  const adapter = new AGUIStreamAdapter(trace)
  logger.info(
    'resume.start trace_id=%s session_id=%s approved=%s modified_args=%d',
    trace, sessionId, approved, Object.keys(modifiedArgs ?? {}).length,
  )

  for await (const eventDict of adapter.transform_langgraph_events(
    resume_stream(graph, sessionId, approved, feedback ?? '', trace, {
      modifiedArgs,
    }),
  )) {
    yield eventDict
  }
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
    next_nodes: state['next_nodes'] ?? [],
    pending_tool_calls: state['pending_tool_calls'] ?? [],
    tool_requires_approval: state['tool_requires_approval'] ?? false,
    trace_id: state['trace_id'] ?? '',
    user_id: state['user_id'] ?? '',
    created_at: state['created_at'] ?? null,
  }
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

