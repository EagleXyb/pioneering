// LLM 接入适配层：网关调用 + AG-UI 编码（P1）
//
// 改造后职责：
//   - 模型解析 / 超时 / 重试 / 熔断 / 计量 全部由 @pioneering/llm-gateway 承担；
//   - 本文件只把网关的标准化增量编码为 AG-UI SSE 事件，chat 路由零改动；
//   - 回滚：设置 LLM_GATEWAY_ENABLED=0 时回落 P0 实现（core/llm-legacy.ts）。
//
// 保留的对外契约（勿改）：
//   - chatCompletion(messages, model?, temperature?, maxTokens?)
//   - streamAgui(messages, assistantMsgId, model?, temperature?, maxTokens?, signal?, usageRef?)
import { LLMError } from '@pioneering/llm-contracts'
import { env } from '../config/env.js'
import { llmGateway } from './llm-gateway.js'
import { recordFirstToken, recordLlmOutcome, type LlmStatus } from './metrics.js'
import * as legacy from './llm-legacy.js'

type Message = { role: string; content: string }

/** 网关开关：默认开启；设为 0/false/off 时回落到 P0 直连实现。 */
function isGatewayEnabled(): boolean {
  const v = (process.env.LLM_GATEWAY_ENABLED ?? '').trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'off'
}

// AG-UI SSE 事件编码 —— 对应 Python AGUIEncoder.to_sse
function toSse(data: Record<string, unknown>): string {
  let payload = JSON.stringify(data)
  // 防止 SSE 注入：转义换行符
  payload = payload.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
  return `data: ${payload}\n\n`
}

// 对应 Python: LlmService.chat_completion（非流式）
export async function chatCompletion(
  messages: Message[],
  model?: string,
  temperature?: number,
  maxTokens?: number,
): Promise<Record<string, unknown>> {
  if (!isGatewayEnabled()) {
    return legacy.chatCompletion(messages, model, temperature, maxTokens)
  }

  const metricModel = model ?? env.LLM_DEFAULT_MODEL
  let result: Awaited<ReturnType<typeof llmGateway.complete>>
  try {
    result = await llmGateway.complete({
      messages,
      model: metricModel,
      temperature,
      maxTokens,
    })
  } catch (e) {
    const err = LLMError.is(e) ? e : null
    recordLlmOutcome(metricModel, {
      status: err?.code === 'UPSTREAM_TIMEOUT' ? 'timeout' : 'error',
      authError: err?.code === 'UNAUTHORIZED',
    })
    throw e
  }

  recordLlmOutcome(metricModel, {
    status: 'success',
    truncated: result.finishReason === 'length',
  })

  const usage = result.usage
    ? {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.totalTokens,
      }
    : undefined

  return {
    choices: [{ message: { content: result.content } }],
    ...(usage ? { usage } : {}),
  }
}

// 对应 Python: LlmService.stream_agui（流式 AG-UI 事件生成器）
// P0-1 修复：增加 signal 参数，支持外部中止上游 LLM 请求
// P1-6 修复：增加 usageRef 参数，捕获上游流式末块的 usage
// P1：实现改为消费网关事件流，AG-UI 编码逻辑保持不变
export async function* streamAgui(
  messages: Message[],
  assistantMsgId: string,
  model?: string,
  temperature?: number,
  maxTokens?: number,
  signal?: AbortSignal,
  usageRef?: { current: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined },
): AsyncGenerator<string, void, unknown> {
  if (!isGatewayEnabled()) {
    yield* legacy.streamAgui(
      messages,
      assistantMsgId,
      model,
      temperature,
      maxTokens,
      signal,
      usageRef,
    )
    return
  }

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

  // P4：链路指标（首 token、截断、失败分类）
  const metricModel = model ?? env.LLM_DEFAULT_MODEL
  const startedAt = Date.now()
  let firstTokenSeen = false
  let finishReason: string | undefined
  let outcomeStatus: LlmStatus = 'success'
  let authError = false

  const markFirstToken = () => {
    if (firstTokenSeen) return
    firstTokenSeen = true
    recordFirstToken((Date.now() - startedAt) / 1000)
  }

  try {
    for await (const ev of llmGateway.stream({
      messages,
      model: metricModel,
      temperature,
      maxTokens,
      signal,
    })) {
      if (ev.type === 'reasoning') {
        markFirstToken()
        yield ensureThinkStart()
        yield toSse({
          type: 'THINKING_TEXT_MESSAGE_CONTENT',
          delta: ev.delta,
          reasoning_content: ev.delta,
        })
      } else if (ev.type === 'content') {
        markFirstToken()
        if (thinkStarted) yield closeThinking()
        yield ensureTextStart()
        yield toSse({
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: assistantMsgId,
          delta: ev.delta,
        })
      } else if (ev.type === 'usage' && usageRef) {
        usageRef.current = {
          promptTokens: ev.usage.promptTokens,
          completionTokens: ev.usage.completionTokens,
          totalTokens: ev.usage.totalTokens,
        }
      } else if (ev.type === 'done') {
        finishReason = ev.finishReason
      }
    }

    yield flushEnd()
  } catch (e) {
    yield flushEnd()
    // 用户停止生成：不向已断开的连接写 RUN_ERROR
    if (signal?.aborted) {
      outcomeStatus = 'aborted'
      return
    }

    const err = LLMError.is(e) ? e : null
    if (err?.code === 'ABORTED') {
      outcomeStatus = 'aborted'
      return
    }

    outcomeStatus = err?.code === 'UPSTREAM_TIMEOUT' ? 'timeout' : 'error'
    authError = err?.code === 'UNAUTHORIZED'

    const code = err?.code === 'UPSTREAM_TIMEOUT' ? 'STREAM_TIMEOUT' : 'STREAM_ERROR'
    yield toSse({
      type: 'RUN_ERROR',
      message: err?.message ?? String(e),
      code,
    })
  } finally {
    recordLlmOutcome(metricModel, {
      status: outcomeStatus,
      truncated: finishReason === 'length',
      authError,
    })
  }
}

// 单例导出（对应 Python: llm_service = LlmService()）
export const llmService = {
  chatCompletion,
  streamAgui,
}
