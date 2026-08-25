// ============================================================
// AG-UI SSE Parser — 通用 AG-UI 协议事件流解析器
// 同时服务于 /chat/completions（普通 LLM 流式）与
// /agent/completions（ReAct Agent 流式，含工具调用）。
//
// 后端事件类型（来自 app/core/llm.py 与 app/core/agent_bridge.py）：
//   RUN_STARTED
//   THINKING_START → THINKING_TEXT_MESSAGE_START →
//     THINKING_TEXT_MESSAGE_CONTENT* → THINKING_TEXT_MESSAGE_END → THINKING_END
//   TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT* → TEXT_MESSAGE_END
//   TOOL_CALL_START → TOOL_CALL_RESULT*        （仅 Agent 端点）
//   RUN_FINISHED
//   RUN_ERROR
// ============================================================

import apiClient from './client'
import type { UserQuestionRequestPayload } from '@shared/types'

export type { UserQuestionRequestPayload }

export interface AguiStreamCallbacks {
  /** 正文增量 */
  onChunk: (delta: string) => void
  /** 思考过程增量（reasoning） */
  onThinking?: (delta: string) => void
  /** 思考会话开始（THINKING_START）。一轮思考会话对应一段独立的思考叙述，
   *  收到此事件时若已有思考内容，应插入轮次分隔，避免多段叙述粘连。 */
  onThinkingStart?: () => void
  /** 工具调用开始（参数可能随后通过 onToolCallArgs 补全） */
  onToolCallStart?: (tool: { id: string; name: string; arguments?: Record<string, unknown> }) => void
  /** 工具调用参数增量（TOOL_CALL_ARGS 事件，delta 为 JSON 字符串片段） */
  onToolCallArgs?: (tool: { id: string; arguments: Record<string, unknown> }) => void
  /** 工具调用结果（结束） */
  onToolCallResult?: (tool: {
    id: string
    name: string
    result: string
    status?: 'completed' | 'error'
    errorMessage?: string
    arguments?: Record<string, unknown>
  }) => void
  /** Agent 产物创建（doc_writer 等工具生成文件时触发） */
  onArtifactCreated?: (artifact: {
    artifactId: string
    name: string
    path: string
    absolutePath?: string
    size: number
    format: string
    type: string
    operation: string
    summary?: string
    title?: string
  }) => void
  /** Plan-and-Execute 状态增量（Plan 步骤更新） */
  onStateDelta?: (delta: {
    phase: string
    plan?: Array<Record<string, unknown>>
    stepUpdate?: Record<string, unknown>
  }) => void
  /** 流结束元信息 */
  onDone: (meta: {
    messageId?: string
    sessionId?: string
    model?: string
    tokenCount?: number
  }) => void
  /** 错误 */
  onError: (error: string) => void
  // ===== HITL（Human-in-the-Loop）事件（阶段零 D3 收敛的最小集合）=====
  /** USER_QUESTION_REQUEST：携带待答复的暂停项（工具审批/澄清/多选） */
  onHumanInputRequest?: (p: UserQuestionRequestPayload) => void
  /** RUN_PAUSED：run 被 interrupt 暂停。不触发 onDone 完成语义，等待用户答复 */
  onRunPaused?: (p?: { threadId: string; runId: string }) => void
  /** HITL_ABORTED：超时/用户取消后收尾 */
  onHitlAborted?: (p?: { threadId: string; runId: string; reason: string }) => void
}

/** 尝试把工具参数 JSON 字符串解析为对象（流式分片可能未完整，解析失败返回 undefined） */
function tryParseToolArgs(s: string): Record<string, unknown> | undefined {
  if (!s) return undefined
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** 把后端工具状态归一为前端 ToolCall.status（未提供时返回 undefined，由 store 默认 completed） */
function normalizeToolStatus(s?: string): 'completed' | 'error' | undefined {
  if (s === 'error' || s === 'failed') return 'error'
  if (s === 'success' || s === 'completed') return 'completed'
  return undefined
}

/** AG-UI 事件对象的最小结构（SSE 解析与 IPC 推送共用） */
interface AguiEventObject {
  type?: string
  threadId?: string
  messageId?: string
  runId?: string
  delta?: string
  toolCallName?: string
  toolCallId?: string
  toolCallStatus?: string
  errorMessage?: string
  content?: string
  model?: string
  tokenCount?: number
  message?: string
  // ARTIFACT_CREATED
  artifactId?: string
  name?: string
  path?: string
  absolutePath?: string
  size?: number
  format?: string
  // STATE_DELTA
  phase?: string
  plan?: unknown[]
  step_update?: Record<string, unknown>
}

/** 终态事件：此后当前 run 不会再有后续事件（IPC 订阅据此自动退订） */
const TERMINAL_AGUI_EVENTS = new Set([
  'RUN_FINISHED',
  'RUN_ERROR',
  'RUN_PAUSED',
  'HITL_ABORTED'
])

/**
 * AG-UI 事件分发器（云边双模阶段 1 抽取）。
 *
 * 把「单个 AG-UI 事件对象 → AguiStreamCallbacks 回调」的映射从 SSE
 * 解析循环中剥离：HttpTransport（SSE 文本流逐行 JSON.parse 后调用）
 * 与 IpcTransport（主进程推送的事件对象直接调用）共用同一份分发
 * 逻辑，保证云边事件语义完全同源。
 *
 * @returns dispatch(event) —— 分发单个事件；返回 true 表示该事件为
 *          终态（RUN_FINISHED / RUN_ERROR / RUN_PAUSED / HITL_ABORTED）
 */
export function createAguiEventDispatcher(cb: AguiStreamCallbacks): {
  dispatch: (event: AguiEventObject) => boolean
} {
  let capturedMessageId = ''
  let capturedSessionId = ''

  // 工具调用按 id 追踪，便于在 RESULT 事件中回填
  const toolCalls = new Map<string, { id: string; name: string }>()
  // 工具参数 JSON 字符串缓冲（TOOL_CALL_ARGS 可能分片到达）
  const toolArgsBuffer = new Map<string, string>()

  const dispatch = (event: AguiEventObject): boolean => {
    switch (event.type) {
      case 'RUN_STARTED':
        capturedSessionId = event.threadId || ''
        break

      case 'THINKING_START':
        // 通知上层新一轮思考会话开始（用于在已有多段叙述时插入轮次分隔）
        cb.onThinkingStart?.()
        break

      case 'THINKING_TEXT_MESSAGE_START':
        // 准备阶段，真正的增量在 THINKING_TEXT_MESSAGE_CONTENT
        break

      case 'THINKING_TEXT_MESSAGE_CONTENT':
        // M3: 兼容后端以 content 字段推送（共享类型 SSEChunk 定义为 content），
        // 否则按 delta 全部丢弃，造成思考过程整段丢失。
        {
          const thinking = event.delta ?? event.content
          if (thinking) cb.onThinking?.(thinking)
        }
        break

      case 'THINKING_TEXT_MESSAGE_END':
      case 'THINKING_END':
        break

      case 'TEXT_MESSAGE_START':
        capturedMessageId = event.messageId || ''
        break

      case 'TEXT_MESSAGE_CONTENT':
        // M3: 兼容后端以 content 字段推送（共享类型 SSEChunk 定义为 content），
        // 否则按 delta 全部丢弃，造成正文整段丢失。
        {
          const text = event.delta ?? event.content
          if (text) cb.onChunk(text)
        }
        break

      case 'TEXT_MESSAGE_END':
        break

      case 'TOOL_CALL_START':
        if (event.toolCallId) {
          const tool = { id: event.toolCallId, name: event.toolCallName || 'tool' }
          toolCalls.set(tool.id, tool)
          // 初始化参数缓冲，等待 TOOL_CALL_ARGS 补全
          toolArgsBuffer.set(tool.id, '')
          cb.onToolCallStart?.(tool)
        }
        break

      // P3: 工具参数增量事件（AG-UI 标准），累积并解析后回填
      case 'TOOL_CALL_ARGS':
        if (event.toolCallId) {
          const prev = toolArgsBuffer.get(event.toolCallId) || ''
          const next = prev + (event.delta ?? '')
          toolArgsBuffer.set(event.toolCallId, next)
          const parsed = tryParseToolArgs(next)
          if (parsed) cb.onToolCallArgs?.({ id: event.toolCallId, arguments: parsed })
        }
        break

      // P4: 解析工具执行状态与错误信息，区分成功/失败
      case 'TOOL_CALL_RESULT':
        if (event.toolCallId) {
          const known = toolCalls.get(event.toolCallId)
          // 兜底：若此前未收到 TOOL_CALL_ARGS，这里用缓冲再做一次解析
          let args: Record<string, unknown> | undefined
          const buf = toolArgsBuffer.get(event.toolCallId)
          if (buf) {
            const parsed = tryParseToolArgs(buf)
            if (parsed) args = parsed
          }
          cb.onToolCallResult?.({
            id: event.toolCallId,
            name: event.toolCallName || known?.name || 'tool',
            result: event.content || '',
            status: normalizeToolStatus(event.toolCallStatus),
            errorMessage: event.errorMessage,
            arguments: args
          })
        }
        break

      case 'RUN_FINISHED':
        cb.onDone({
          messageId: capturedMessageId,
          sessionId: capturedSessionId,
          model: event.model,
          tokenCount: event.tokenCount
        })
        break

      case 'ARTIFACT_CREATED':
        if (event.artifactId && event.name) {
          cb.onArtifactCreated?.({
            artifactId: event.artifactId,
            name: event.name,
            path: event.path || '',
            absolutePath: event.absolutePath,
            size: event.size ?? 0,
            format: event.format || 'md',
            type: 'document',
            operation: (event as Record<string, unknown>).operation as string || 'create',
            summary: (event as Record<string, unknown>).summary as string | undefined,
            title: (event as Record<string, unknown>).title as string | undefined,
          })
        }
        break

      case 'STATE_DELTA':
        // P1-9: Plan-and-Execute 步骤事件，由 stream-handler 转为 plan-step TraceNode
        if (event.phase === 'plan' && Array.isArray(event.plan)) {
          cb.onStateDelta?.({
            phase: 'plan',
            plan: event.plan as Array<Record<string, unknown>>,
          })
        } else if (event.step_update) {
          cb.onStateDelta?.({
            phase: event.phase || 'execute',
            stepUpdate: event.step_update,
          })
        }
        break

      case 'USER_QUESTION_REQUEST': {
        // HITL：携带待答复的暂停项（kind/tool_calls/question/options）
        cb.onHumanInputRequest?.({
          kind: (event as Record<string, unknown>).kind as UserQuestionRequestPayload['kind'] ?? 'tool_confirm',
          session_id: (event as Record<string, unknown>).session_id as string ?? '',
          run_id: (event as Record<string, unknown>).run_id as string | undefined,
          message: event.message,
          tool_calls: (event as Record<string, unknown>).tool_calls as UserQuestionRequestPayload['tool_calls'],
          question: (event as Record<string, unknown>).question as string | undefined,
          options: (event as Record<string, unknown>).options as UserQuestionRequestPayload['options'],
        })
        break
      }

      case 'RUN_PAUSED': {
        // HITL：run 被 interrupt 暂停——不触发 onDone 完成语义，等待用户答复
        cb.onRunPaused?.({
          threadId: (event as Record<string, unknown>).threadId as string ?? capturedSessionId,
          runId: (event as Record<string, unknown>).runId as string ?? '',
        })
        break
      }

      case 'HITL_ABORTED': {
        // HITL：超时/用户取消后收尾
        cb.onHitlAborted?.({
          threadId: (event as Record<string, unknown>).threadId as string ?? capturedSessionId,
          runId: (event as Record<string, unknown>).runId as string ?? '',
          reason: (event as Record<string, unknown>).reason as string ?? 'user_cancel',
        })
        break
      }

      case 'RUN_ERROR':
        cb.onError(event.message || 'Unknown error')
        break
    }
    return TERMINAL_AGUI_EVENTS.has(event.type ?? '')
  }

  return { dispatch }
}

/**
 * 向后端发起 AG-UI 流式请求并解析 SSE。
 * 返回的 AbortController 由调用方持有，用于停止生成。
 */
export function streamAgui(
  url: string,
  body: unknown,
  cb: AguiStreamCallbacks
): AbortController {
  const controller = new AbortController()

  const { dispatch } = createAguiEventDispatcher(cb)

  apiClient
    .stream(url, body, { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        cb.onError((errData as { message?: string }).message || `HTTP ${response.status}`)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        cb.onError('Response body is not readable')
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue

          const jsonStr = trimmed.slice(5).trim()
          if (jsonStr === '[DONE]') continue

          try {
            dispatch(JSON.parse(jsonStr) as AguiEventObject)
          } catch {
            // M3: 解析失败不再静默吞掉。至少告警并打印原始行，
            // 便于发现后端契约变更（如字段名/格式调整）导致的数据丢失。
            console.warn('[agui] 跳过无法解析的 SSE 行:', jsonStr)
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        const base = apiClient.getBaseURL()
        console.error('[streamAgui] fetch failed', base + url, err)
        cb.onError(`${err.message || 'Network error'} @ ${base}${url}`)
      }
    })

  return controller
}
