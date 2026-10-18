// OpenAI 兼容协议适配器（P1）
//
// 覆盖 DeepSeek / GLM / Qwen / OpenAI 等所有走 /chat/completions 的服务。
// 职责：
//   - 构造请求（含 Authorization / baseURL / 流式开关）
//   - 解析非流式响应与流式 SSE（含 reasoning_content 与 usage）
//   - 把 HTTP / 网络异常翻译成 LLMError
// 不负责：别名解析、重试、熔断、超时（均在 llm-core / llm-gateway）。
import {
  LLMError,
  toLLMError,
  type ChatRequest,
  type ChatResult,
  type ChatStreamEvent,
  type ChatUsage,
} from '@pioneering/llm-contracts'
import { parseSSEDataLine, splitSSEBuffer } from './sse.js'

export interface OpenAICompatibleConfig {
  apiKey: string
  baseUrl: string
  /** 便于测试注入；默认使用全局 fetch（Node 内置 undici） */
  fetchImpl?: typeof fetch
  /** 追加请求头（代理网关鉴权等场景） */
  headers?: Record<string, string>
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function mapUsage(raw: any): ChatUsage | undefined {
  if (!raw) return undefined
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
  }
}

function mapHttpError(status: number, body: string): LLMError {
  const message = `LLM API error: ${status} - ${body.slice(0, 500)}`
  if (status === 401 || status === 403) {
    return new LLMError('UNAUTHORIZED', message, { status })
  }
  if (status === 429) {
    return new LLMError('RATE_LIMITED', message, { status })
  }
  return new LLMError('UPSTREAM_ERROR', message, { status })
}

export class OpenAICompatibleAdapter {
  private readonly _cfg: OpenAICompatibleConfig

  constructor(cfg: OpenAICompatibleConfig) {
    this._cfg = cfg
  }

  /** 非流式补全。 */
  async complete(req: ChatRequest): Promise<ChatResult> {
    const response = await this._request(req, false)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw mapHttpError(response.status, text)
    }

    let data: any
    try {
      data = await response.json()
    } catch (e) {
      throw new LLMError('BAD_RESPONSE', '上游返回非 JSON 响应', { cause: e })
    }

    const choice = data?.choices?.[0]
    if (!choice) {
      throw new LLMError('BAD_RESPONSE', '上游响应缺少 choices')
    }

    return {
      content: typeof choice.message?.content === 'string' ? choice.message.content : '',
      reasoning:
        typeof choice.message?.reasoning_content === 'string'
          ? choice.message.reasoning_content
          : undefined,
      usage: mapUsage(data?.usage),
      finishReason: choice.finish_reason ?? undefined,
    }
  }

  /**
   * 流式补全。
   *
   * 产出 content / reasoning 增量；返回值携带聚合正文、usage 与 finish_reason。
   * 面向 AsyncGenerator 的返回值语义，调用方需用 `it.next()` 读取终值。
   */
  async *stream(req: ChatRequest): AsyncGenerator<ChatStreamEvent, ChatResult, void> {
    const response = await this._request(req, true)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw mapHttpError(response.status, text)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new LLMError('BAD_RESPONSE', '上游无响应体')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let reasoning = ''
    let usage: ChatUsage | undefined
    let finishReason: string | undefined
    let streamDone = false

    try {
      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const split = splitSSEBuffer(buffer)
        buffer = split.rest

        for (const rawLine of split.lines) {
          const payload = parseSSEDataLine(rawLine)
          if (!payload) continue
          if (payload === '[DONE]') {
            streamDone = true
            break
          }

          let chunk: any
          try {
            chunk = JSON.parse(payload)
          } catch {
            // 心跳 / 非 JSON 行：忽略
            continue
          }

          if (chunk.usage) usage = mapUsage(chunk.usage) ?? usage

          const choice = chunk.choices?.[0]
          if (!choice) continue
          if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
            finishReason = choice.finish_reason
          }

          const delta = choice.delta ?? {}

          const reasoningDelta = delta.reasoning_content
          if (typeof reasoningDelta === 'string' && reasoningDelta) {
            reasoning += reasoningDelta
            yield { type: 'reasoning', delta: reasoningDelta }
          }

          const contentDelta = delta.content
          if (typeof contentDelta === 'string' && contentDelta) {
            content += contentDelta
            yield { type: 'content', delta: contentDelta }
          }
        }
      }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        throw new LLMError('ABORTED', '请求已中止', { cause: e })
      }
      throw toLLMError(e)
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // 流已关闭时 release 可能抛错，忽略
      }
    }

    return { content, reasoning, usage, finishReason }
  }

  private async _request(req: ChatRequest, stream: boolean): Promise<Response> {
    const url = `${trimTrailingSlash(this._cfg.baseUrl)}/chat/completions`
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream,
    }
    if (req.temperature !== undefined && req.temperature !== null) {
      body.temperature = req.temperature
    }
    if (req.maxTokens !== undefined && req.maxTokens !== null) {
      body.max_tokens = req.maxTokens
    }

    const fetchImpl = this._cfg.fetchImpl ?? globalThis.fetch
    if (!fetchImpl) {
      throw new LLMError('UPSTREAM_ERROR', '运行环境缺少 fetch 实现')
    }

    try {
      return await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this._cfg.apiKey}`,
          'Content-Type': 'application/json',
          ...(this._cfg.headers ?? {}),
        },
        body: JSON.stringify(body),
        signal: req.signal ?? undefined,
      })
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        throw new LLMError('ABORTED', '请求已中止', { cause: e })
      }
      throw toLLMError(e)
    }
  }
}

export function createOpenAICompatibleAdapter(
  cfg: OpenAICompatibleConfig,
): OpenAICompatibleAdapter {
  return new OpenAICompatibleAdapter(cfg)
}
