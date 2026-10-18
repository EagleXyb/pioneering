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

/**
 * 流式响应的空闲超时控制器（P0）。
 *
 * 背景：改造前用 `AbortSignal.timeout(120_000)` 覆盖整个响应体读取，
 * 长回答 / 深度思考超过 2 分钟会被硬切断。流式场景真正需要防的是
 * "连接还在但长期没有数据"，因此改为空闲超时：每收到一个 chunk 重置计时，
 * 总时长不设上限。
 *
 * 外部 signal（用户停止生成）仍会被透传，触发时与空闲超时同样中止上游请求，
 * 由调用方通过 `signal.aborted` 区分两者。
 */
function createIdleTimeoutSignal(idleMs: number, external?: AbortSignal | null) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null

  const refresh = () => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      controller.abort(new Error(`LLM stream idle timeout (${idleMs}ms)`))
    }, idleMs)
    // Node 环境下避免定时器阻止进程退出；浏览器/测试环境无 unref
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }

  const onExternalAbort = () => controller.abort(external?.reason)
  if (external) {
    if (external.aborted) controller.abort(external.reason)
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  refresh()

  const dispose = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    external?.removeEventListener('abort', onExternalAbort)
  }

  return { signal: controller.signal, refresh, dispose }
}

// 对应 Python: LlmService.stream_agui（流式 AG-UI 事件生成器）
// P0-1 修复：增加 signal 参数，支持外部中止上游 LLM 请求
// P1-6 修复：增加 usageRef 参数，捕获上游流式末块的 usage（OpenAI/DeepSeek 末块带 usage）
export async function* streamAgui(
  messages: Message[],
  assistantMsgId: string,
  model?: string,
  temperature?: number,
  maxTokens?: number,
  signal?: AbortSignal,
  usageRef?: { current: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined },
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

  // P0：流式改为空闲超时（每收到数据重置），不再限制总时长。
  // 外部 signal（停止生成）仍联动中止上游请求。
  const idle = createIdleTimeoutSignal(env.LLM_STREAM_IDLE_TIMEOUT_MS, signal)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: idle.signal,
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
      // 每收到一个 chunk 重置空闲计时（首 token 之前同样受此保护）
      idle.refresh()

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

        // P1-6 修复：捕获上游流式末块的 usage（OpenAI/DeepSeek 末块带 usage 字段）
        // 流结束时由调用方读取 usageRef.current 拿到真实用量
        if (usageRef && chunk.usage) {
          usageRef.current = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          }
        }

        if (reasoningContent) {
          yield ensureThinkStart()
          yield toSse({ type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: reasoningContent, reasoning_content: reasoningContent })
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
  } catch (e: any) {
    // 先收尾已开始的文本/思考事件边界
    yield flushEnd()
    // 外部 abort（用户停止生成）：不向已断开的连接写 RUN_ERROR
    if (signal?.aborted) {
      return
    }
    // 空闲超时（AbortController 由本模块触发）：给出可重试的明确错误
    if (e?.name === 'AbortError') {
      yield toSse({
        type: 'RUN_ERROR',
        message: `LLM 响应空闲超时（${env.LLM_STREAM_IDLE_TIMEOUT_MS}ms 无数据）`,
        code: 'STREAM_TIMEOUT',
      })
      return
    }
    yield toSse({ type: 'RUN_ERROR', message: String(e), code: 'STREAM_ERROR' })
  } finally {
    idle.dispose()
  }
}

// 单例导出（对应 Python: llm_service = LlmService()）
export const llmService = {
  chatCompletion,
  streamAgui,
}
