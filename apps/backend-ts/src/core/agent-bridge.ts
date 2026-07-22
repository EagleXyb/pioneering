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

  try {
    for await (const eventDict of adapter.transform_langgraph_events(
      stream_response(graph, userId, sessionId, inputData, traceId),
    )) {
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
// collectMetadataFromEvent（对应 Python _collect_metadata_from_event）
// ============================================================

/**
 * 从 AG-UI 事件中提取元数据，填充 StreamContext。
 * 对应 Python: _collect_metadata_from_event
 */
function collectMetadataFromEvent(
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
  } else if (eventType === 'RUN_ERROR') {
    ctx.hasError = true
    ctx.errorInfo = { code: data.code ?? '', message: data.message ?? '' }
  } else if (eventType === 'STATE_DELTA') {
    // P4: 收集 Plan-Execute 元数据，供持久化与前端状态恢复
    const phase = data.phase ?? ''
    if (phase === 'plan' && Array.isArray(data.plan)) {
      ctx.planData = data.plan
    } else if (phase === 'execute' && data.step_update) {
      ctx.stepUpdates.push(data.step_update)
    }
  }
}
