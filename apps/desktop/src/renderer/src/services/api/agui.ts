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

export interface AguiStreamCallbacks {
  /** 正文增量 */
  onChunk: (delta: string) => void
  /** 思考过程增量（reasoning） */
  onThinking?: (delta: string) => void
  /** 工具调用开始 */
  onToolCallStart?: (tool: { id: string; name: string }) => void
  /** 工具调用结果（结束） */
  onToolCallResult?: (tool: { id: string; name: string; result: string }) => void
  /** 流结束元信息 */
  onDone: (meta: {
    messageId?: string
    sessionId?: string
    model?: string
    tokenCount?: number
  }) => void
  /** 错误 */
  onError: (error: string) => void
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

  let capturedMessageId = ''
  let capturedSessionId = ''

  // 工具调用按 id 追踪，便于在 RESULT 事件中回填
  const toolCalls = new Map<string, { id: string; name: string }>()

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
            const event = JSON.parse(jsonStr) as {
              type?: string
              threadId?: string
              messageId?: string
              runId?: string
              delta?: string
              toolCallName?: string
              toolCallId?: string
              content?: string
              model?: string
              tokenCount?: number
              message?: string
            }

            switch (event.type) {
              case 'RUN_STARTED':
                capturedSessionId = event.threadId || ''
                break

              case 'THINKING_START':
              case 'THINKING_TEXT_MESSAGE_START':
                // 准备阶段，真正的增量在 THINKING_TEXT_MESSAGE_CONTENT
                break

              case 'THINKING_TEXT_MESSAGE_CONTENT':
                if (event.delta) cb.onThinking?.(event.delta)
                break

              case 'THINKING_TEXT_MESSAGE_END':
              case 'THINKING_END':
                break

              case 'TEXT_MESSAGE_START':
                capturedMessageId = event.messageId || ''
                break

              case 'TEXT_MESSAGE_CONTENT':
                if (event.delta) cb.onChunk(event.delta)
                break

              case 'TEXT_MESSAGE_END':
                break

              case 'TOOL_CALL_START':
                if (event.toolCallId) {
                  const tool = { id: event.toolCallId, name: event.toolCallName || 'tool' }
                  toolCalls.set(tool.id, tool)
                  cb.onToolCallStart?.(tool)
                }
                break

              case 'TOOL_CALL_RESULT':
                if (event.toolCallId) {
                  const known = toolCalls.get(event.toolCallId)
                  const tool = {
                    id: event.toolCallId,
                    name: event.toolCallName || known?.name || 'tool',
                    result: event.content || ''
                  }
                  cb.onToolCallResult?.(tool)
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

              case 'RUN_ERROR':
                cb.onError(event.message || 'Unknown error')
                break
            }
          } catch {
            // 忽略非 JSON 行
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        cb.onError(err.message || 'Network error')
      }
    })

  return controller
}
