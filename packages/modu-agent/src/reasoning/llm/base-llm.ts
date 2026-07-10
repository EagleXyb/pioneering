// 对应 Python: components/reasoning/llm/base_llm.py
// LLM 推理引擎基类
//
// 使用 OpenAI 兼容 API（/chat/completions）进行推理。
// 支持同步/异步推理、流式输出、原生 function calling。
//
// P2-12.3.1: Python 版复用 httpx 连接池；TS 版使用原生 fetch，
// Node.js undici 自动管理 keep-alive 连接池，无需显式 Client 对象。
//
// 注：Python 版 reason() 为同步方法、areason() 为异步方法；
//    TS 版 reason() 本身为异步（fetch 异步），areason() 委托 reason()。
//    stream/astream 同理。
import { BaseReasoningEngine } from '../../core/interfaces/reasoning.js'
import { getConfig } from '../../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[base-llm] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[base-llm] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[base-llm] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[base-llm] ${msg}`, ...args),
}

/**
 * LLM 推理引擎基类。
 * 对应 Python BaseLLMReasoner。
 *
 * 所有 LLM 推理器（DeepSeek / GLM / GPT / Qwen）继承此类，
 * 仅需在子类构造函数中解析 API key / base_url / model。
 */
export class BaseLLMReasoner extends BaseReasoningEngine {
  protected _apiKey: string
  protected _baseUrl: string
  protected _defaultModel: string
  protected _timeout: number
  protected _systemPrompt: string | null

  constructor(
    apiKey: string,
    baseUrl: string,
    defaultModel: string,
    timeout: number = 120.0,
    systemPrompt?: string | null,
  ) {
    super()
    this._apiKey = apiKey
    this._baseUrl = baseUrl.replace(/\/+$/, '')
    this._defaultModel = defaultModel
    this._timeout = timeout
    this._systemPrompt = systemPrompt ?? null
    // P2-12.3.1: Python 复用 httpx 连接池（httpx.Client / httpx.AsyncClient）；
    // TS 使用原生 fetch，Node.js undici 自动管理 keep-alive 连接池，无需显式 Client
  }

  /** 释放底层连接池资源。TS 版使用原生 fetch，无需显式关闭。 */
  close(): void {
    // Python 版关闭 httpx.Client 和 httpx.AsyncClient；
    // TS 版 fetch 由 Node.js undici 管理连接池，进程退出时自动清理。
  }

  // 注：Python 版有 __del__ 析构方法调用 close()；
  //    JS 无析构函数，用户应显式调用 close()。

  /**
   * P1-5: temperature 默认值从 RuntimeConfig 读取，kwargs 优先覆盖。
   *
   * 解析优先级：显式 kwargs > RuntimeConfig(llm.temperature) > 0.7 兜底。
   * 配置不可用时安全降级。
   */
  protected _resolveTemperature(kwargs: Record<string, any>): number {
    if ('temperature' in kwargs) {
      return kwargs['temperature']
    }
    try {
      return getConfig().get('llm.temperature', 0.7)
    } catch {
      return 0.7
    }
  }

  /**
   * P1-5: max_tokens 默认值从 RuntimeConfig 读取，kwargs 优先覆盖。
   *
   * 解析优先级：显式 kwargs > RuntimeConfig(llm.max_tokens) > 512 兜底。
   */
  protected _resolveMaxTokens(kwargs: Record<string, any>): number {
    if ('max_tokens' in kwargs) {
      return kwargs['max_tokens']
    }
    try {
      return getConfig().get('llm.max_tokens', 512)
    } catch {
      return 512
    }
  }

  get apiKey(): string {
    return this._apiKey
  }

  get baseUrl(): string {
    return this._baseUrl
  }

  get defaultModel(): string {
    return this._defaultModel
  }

  /**
   * 同步推理（P2-12.3.1：复用实例级 httpx 连接池）。
   *
   * TS 版 reason 本身为异步（fetch 异步），与 Python areason 语义等价。
   */
  async reason(
    prompt: string,
    context: Record<string, any>,
    kwargs: Record<string, any> = {},
  ): Promise<[string, Record<string, number>, Array<Record<string, any>>]> {
    const messages = this._buildMessages(prompt, context)
    const temperature = this._resolveTemperature(kwargs)
    const maxTokens = this._resolveMaxTokens(kwargs)
    const model = kwargs['model'] ?? this._defaultModel
    const tools = context['native_tools'] || kwargs['tools']

    const url = `${this._baseUrl}/chat/completions`
    const headers = this._buildHeaders()
    const payload: Record<string, any> = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }
    if (tools) {
      payload['tools'] = tools
    }

    // P2-12.3.1: 复用实例级连接池（fetch 内部由 undici 管理 keep-alive）
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this._timeout * 1000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = (await response.json()) as Record<string, any>

    const choices = (data['choices'] ?? [{}]) as Array<Record<string, any>>
    const message = (choices[0]?.['message'] ?? {}) as Record<string, any>
    const content = (message['content'] ?? '') as string || ''
    const rawToolCalls = (message['tool_calls'] ?? []) as Array<Record<string, any>>

    const usageData = (data['usage'] ?? {}) as Record<string, any>
    const usage: Record<string, number> = {
      prompt_tokens: usageData['prompt_tokens'] ?? 0,
      completion_tokens: usageData['completion_tokens'] ?? 0,
      total_tokens: usageData['total_tokens'] ?? 0,
    }

    const parsedToolCalls: Array<Record<string, any>> = []
    for (const tc of rawToolCalls) {
      try {
        const func = (tc['function'] ?? {}) as Record<string, any>
        const tcName = (func['name'] ?? '') as string
        const argsStr = func['arguments'] ?? '{}'
        const args = typeof argsStr === 'string' ? JSON.parse(argsStr) : argsStr
        if (tcName) {
          parsedToolCalls.push({ tool: tcName, parameters: args })
        }
      } catch (e) {
        logger.warning('Failed to parse tool_call arguments: %s', String(e))
      }
    }

    logger.debug(
      'LLM response: model=%s tokens=%s tool_calls=%d',
      data['model'] ?? model,
      JSON.stringify(usage),
      parsedToolCalls.length,
    )
    return [content, usage, parsedToolCalls]
  }

  /**
   * 同步流式推理。
   *
   * P1-12.2.5：temperature/max_tokens 不再硬编码，通过 kwargs 覆盖。
   * P2-12.3.1：复用实例级 httpx 连接池。
   *
   * TS 版 stream 为异步生成器（fetch 流式读取），与 Python astream 语义等价。
   */
  async *stream(
    prompt: string,
    context: Record<string, any>,
    kwargs: Record<string, any> = {},
  ): AsyncGenerator<string, void, unknown> {
    const messages = this._buildMessages(prompt, context)
    const temperature = this._resolveTemperature(kwargs)
    const maxTokens = this._resolveMaxTokens(kwargs)
    const model = kwargs['model'] ?? this._defaultModel
    const url = `${this._baseUrl}/chat/completions`
    const headers = this._buildHeaders()
    const payload: Record<string, any> = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }

    // P2-12.3.1: 复用实例级连接池（fetch 内部由 undici 管理 keep-alive）
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this._timeout * 1000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 处理完整的 SSE 行
        let newlineIdx: number
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx).replace(/\r$/, '')
          buffer = buffer.slice(newlineIdx + 1)

          if (!line.startsWith('data: ')) {
            continue
          }
          const data = line.slice(6)
          if (data.trim() === '[DONE]') {
            return
          }
          try {
            const chunk = JSON.parse(data)
            const choices = (chunk['choices'] ?? [{}]) as Array<Record<string, any>>
            const delta = (choices[0]?.['delta'] ?? {}) as Record<string, any>
            const content = (delta['content'] ?? '') as string
            if (content) {
              yield content
            }
          } catch {
            continue
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * 异步推理（P2-12.3.1：复用实例级 httpx.AsyncClient 连接池）。
   *
   * 与 reason() 语义等价，但在 async 环境下不占用线程池。
   * TS 版 reason() 本身为异步，areason() 直接委托。
   */
  async areason(
    prompt: string,
    context: Record<string, any>,
    kwargs: Record<string, any> = {},
  ): Promise<[string, Record<string, number>, Array<Record<string, any>>]> {
    return this.reason(prompt, context, kwargs)
  }

  /**
   * 异步流式推理。
   *
   * P1-12.2.5：temperature/max_tokens 不再硬编码，通过 kwargs 覆盖。
   * P2-12.3.1：复用实例级 httpx.AsyncClient 连接池，发挥 async 优势。
   *
   * TS 版 stream() 本身为异步生成器，astream() 直接委托。
   */
  async *astream(
    prompt: string,
    context: Record<string, any>,
    kwargs: Record<string, any> = {},
  ): AsyncGenerator<string, void, unknown> {
    yield* this.stream(prompt, context, kwargs)
  }

  protected _buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this._apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  protected _buildMessages(
    prompt: string,
    context: Record<string, any>,
  ): Array<Record<string, string>> {
    const messages: Array<Record<string, string>> = []

    if (this._systemPrompt) {
      messages.push({ role: 'system', content: this._systemPrompt })
    }

    const memoryContext = context['memory_context']
    if (memoryContext) {
      messages.push({
        role: 'system',
        content: `Relevant context from memory:\n${memoryContext}`,
      })
    }

    const toolDescriptions = context['tool_descriptions']
    if (toolDescriptions) {
      messages.push({
        role: 'system',
        content: `Available tools:\n${toolDescriptions}`,
      })
    }

    const history = context['history']
    if (Array.isArray(history)) {
      for (const entry of history) {
        if (entry && typeof entry === 'object' && 'role' in entry && 'content' in entry) {
          messages.push({ role: entry['role'], content: entry['content'] })
        }
      }
    }

    messages.push({ role: 'user', content: prompt })
    return messages
  }
}
