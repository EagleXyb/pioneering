// LLM 直连服务 —— 对应 Python app/core/llm.py
// 直连 OpenAI 兼容 /chat/completions，产出 AG-UI SSE 事件
import { env } from '../config/env.js'

type Message = { role: string; content: string }

// 对应 Python: LlmService.chat_completion（非流式）
export async function chatCompletion(
  messages: Message[],
  model?: string,
  temperature?: number,
  maxTokens?: number,
): Promise<Record<string, unknown>> {
  const url = `${env.LLM_BASE_URL}/chat/completions`
  const payload: Record<string, unknown> = {
    model: model || env.LLM_DEFAULT_MODEL,
    messages,
    stream: false,
  }
  if (temperature !== undefined && temperature !== null) payload.temperature = temperature
  if (maxTokens !== undefined && maxTokens !== null) payload.max_tokens = maxTokens

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    const error = new Error(`LLM API error: ${response.status} - ${errBody.slice(0, 500)}`)
    ;(error as any).statusCode = 502
    throw error
  }

  return (await response.json()) as Record<string, unknown>
}

// AG-UI SSE 事件编码 —— 对应 Python AGUIEncoder.to_sse
function toSse(data: Record<string, unknown>): string {
  let payload = JSON.stringify(data)
  // 防止 SSE 注入：转义换行符
  payload = payload.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
  return `data: ${payload}\n\n`
}

// 对应 Python: LlmService.stream_agui（流式 AG-UI 事件生成器）
export async function* streamAgui(
  messages: Message[],
  assistantMsgId: string,
  model?: string,
  temperature?: number,
  maxTokens?: number,
): AsyncGenerator<string, void, unknown> {
  const url = `${env.LLM_BASE_URL}/chat/completions`
  const payload: Record<string, unknown> = {
    model: model || env.LLM_DEFAULT_MODEL,
    messages,
    stream: true,
  }
  if (temperature !== undefined && temperature !== null) payload.temperature = temperature
  if (maxTokens !== undefined && maxTokens !== null) payload.max_tokens = maxTokens

  let textMsgStarted = false
  let thinkStarted = false
  let thinkTextStarted = false

  // 对应 Python: _ensure_text_start
  const ensureTextStart = (): string => {
    if (!textMsgStarted) {
      textMsgStarted = true
      return toSse({ type: 'TEXT_MESSAGE_START', messageId: assistantMsgId, role: 'assistant' })
    }
    return ''
  }

  // 对应 Python: _ensure_think_start
  const ensureThinkStart = (): string => {
    const parts: string[] = []
    if (!thinkStarted) {
      thinkStarted = true
      parts.push(toSse({ type: 'THINKING_START' }))
    }
    if (!thinkTextStarted) {
      thinkTextStarted = true
      parts.push(toSse({ type: 'THINKING_TEXT_MESSAGE_START' }))
    }
    return parts.join('')
  }

  // 对应 Python: _close_thinking
  const closeThinking = (): string => {
    const parts: string[] = []
    if (thinkTextStarted) {
      parts.push(toSse({ type: 'THINKING_TEXT_MESSAGE_END' }))
      thinkTextStarted = false
    }
    if (thinkStarted) {
      parts.push(toSse({ type: 'THINKING_END' }))
      thinkStarted = false
    }
    return parts.join('')
  }

  // 对应 Python: _flush_end
  const flushEnd = (): string => {
    const parts: string[] = [closeThinking()]
    if (textMsgStarted) {
      parts.push(toSse({ type: 'TEXT_MESSAGE_END', messageId: assistantMsgId }))
      textMsgStarted = false
    }
    return parts.join('')
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    })

    if (response.status !== 200) {
      const errorText = await response.text().catch(() => '')
      yield toSse({
        type: 'RUN_ERROR',
        message: `LLM API error: ${response.status} - ${errorText.slice(0, 500)}`,
        code: 'LLM_ERROR',
      })
      return
    }

    // 流式逐行读取 SSE（对应 Python: async for line in response.aiter_lines()）
    const reader = response.body?.getReader()
    if (!reader) {
      yield toSse({ type: 'RUN_ERROR', message: 'No response body', code: 'LLM_ERROR' })
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // 按行处理（SSE 行以 \n 分隔）
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // 保留最后不完整的行

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data.trim() === '[DONE]') {
          buffer = '' // 清空，外层 while 会在下次 done 时退出
          break
        }

        let chunk: any
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }

        const delta = chunk.choices?.[0]?.delta || {}
        const reasoningContent = delta.reasoning_content || ''
        const content = delta.content || ''

        if (reasoningContent) {
          yield ensureThinkStart()
          yield toSse({ type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: reasoningContent })
        }

        if (content) {
          if (thinkStarted) {
            yield closeThinking()
          }
          yield ensureTextStart()
          yield toSse({ type: 'TEXT_MESSAGE_CONTENT', messageId: assistantMsgId, delta: content })
        }
      }

      if (buffer.includes('[DONE]')) break
    }

    // 流结束
    yield flushEnd()
  } catch (e) {
    yield flushEnd()
    yield toSse({ type: 'RUN_ERROR', message: String(e), code: 'STREAM_ERROR' })
  }
}

// 单例导出（对应 Python: llm_service = LlmService()）
export const llmService = {
  chatCompletion,
  streamAgui,
}
