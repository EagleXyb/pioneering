// 对应 Python: components/reasoning/llm/base_llm.py
// LLM 推理引擎基类
//
// 使用 OpenAI 兼容 API（/chat/completions）进行推理。
// 支持同步/异步推理、流式输出、原生 function calling。
//
// P2-12.3.1: Python 版复用 httpx 连接池；TS 版使用原生 fetch，
// Node.js undici 自动管理 keep-alive 连接池，无需显式 Client 对象。
//
// 统一 LLM 接口改造（对应文档 §2.1）：
//   - 实现 ModuLLM 接口（invoke/stream/bindTools/withRetry）
//   - invoke() 返回结构化 LLMResult，替代三元组反模式
//   - 引入 undici.Agent 显式管理连接池（llm.connection_pool.enabled 开关）
//   - 在 invoke 内发布 LLM.COST 事件，统一采集 token 用量
//   - 旧接口 reason/areason/stream/astream 标记 @deprecated，保留向后兼容
//
// 注：Python 版 reason() 为同步方法、areason() 为异步方法；
//    TS 版 reason() 本身为异步（fetch 异步），areason() 委托 reason()。
//    stream/astream 同理。
import { BaseReasoningEngine } from '../../core/interfaces/reasoning.js'
import type {
  LLMInvokeOptions,
  LLMMessage,
  LLMResult,
  LLMRetryOptions,
  LLMToolCall,
  ModuLLM,
} from '../../core/interfaces/llm.js'
import { getConfig } from '../../config/runtime-config.js'
import { publish_llm_cost_event } from './cost-tracker.js'
import { isRetryableException } from '../../graph/adapters/retry.js'

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
 *
 * 实现统一 ModuLLM 接口（对应文档 §2.1）：
 *   - invoke() / stream() / bindTools() / withRetry() 满足统一调用约定
 *   - 旧接口 reason() / areason() / stream() / astream() 标记 @deprecated，
 *     保留向后兼容，新代码应使用 invoke()
 *
 * @deprecated 建议新代码通过 ModuLLM 接口消费 LLM，
 *             独立场景（如 LLM Judge）改用 build_modu_llm 适配的 ChatOpenAI 路径，
 *             消除双轨抽象。本类保留用于向后兼容与无 LangChain 依赖场景。
 */
export class BaseLLMReasoner extends BaseReasoningEngine implements ModuLLM {
  protected _apiKey: string
  protected _baseUrl: string
  protected _defaultModel: string
  protected _timeout: number
  protected _systemPrompt: string | null
  /** Provider 标识（glm/deepseek/gpt/qwen），由子类设置或从 baseUrl 推断 */
  protected _provider: string
  /** 绑定的工具列表（bindTools 后填充，invoke 时透传到 payload.tools） */
  protected _boundTools: any[] | null = null
  /** 重试配置（withRetry 后填充，invoke 时应用） */
  protected _retryOpts: LLMRetryOptions | null = null
  /** undici.Agent 显式连接池（llm.connection_pool.enabled 启用时初始化） */
  private _dispatcher: any = null

  constructor(
    apiKey: string,
    baseUrl: string,
    defaultModel: string,
    timeout: number = 120.0,
    systemPrompt?: string | null,
    provider: string = 'unknown',
  ) {
    super()
    this._apiKey = apiKey
    this._baseUrl = baseUrl.replace(/\/+$/, '')
    this._defaultModel = defaultModel
    this._timeout = timeout
    this._systemPrompt = systemPrompt ?? null
    this._provider = provider
    // 统一 LLM 接口层连接池显式管理（对应文档 §2.1 连接池显式化建议）
    // 默认关闭，启用后使用 undici.Agent 替代默认全局连接池
    this._initDispatcher()
  }

  /**
   * 初始化 undici.Agent 显式连接池。
   *
   * 仅当 llm.connection_pool.enabled=true 时启用，否则保持默认 fetch 行为。
   * undici 包是 Node.js 内置（Node 18+），通过动态 import 避免显式声明依赖。
   */
  private async _initDispatcher(): Promise<void> {
    let poolEnabled = false
    try {
      poolEnabled = Boolean(getConfig().get('llm.connection_pool.enabled', false))
    } catch {
      poolEnabled = false
    }
    if (!poolEnabled) {
      return
    }
    try {
      const { Agent } = await import('undici')
      const maxConnections = Number(getConfig().get('llm.connection_pool.max_connections', 100))
      const keepAliveTimeout = Number(getConfig().get('llm.connection_pool.keep_alive_timeout', 4000))
      const keepAliveMaxTimeout = Number(getConfig().get('llm.connection_pool.keep_alive_max_timeout', 300000))
      this._dispatcher = new Agent({
        connections: maxConnections,
        keepAliveTimeout,
        keepAliveMaxTimeout,
      })
      logger.debug(
        'undici.Agent initialized: maxConnections=%d keepAliveTimeout=%dms',
        maxConnections, keepAliveTimeout,
      )
    } catch (e) {
      logger.warning('Failed to init undici.Agent, falling back to default fetch: %s', String(e))
      this._dispatcher = null
    }
  }

  /** 释放底层连接池资源。 */
  close(): void {
    if (this._dispatcher && typeof this._dispatcher.close === 'function') {
      try {
        this._dispatcher.close()
      } catch {
        // ignore
      }
    }
    this._dispatcher = null
  }

  // 注：Python 版有 __del__ 析构方法调用 close()；
  //    JS 无析构函数，用户应显式调用 close()。

  // ============================================================
  // ModuLLM 接口实现
  // ============================================================

  /** @inheritdoc */
  get model(): string {
    return this._defaultModel
  }

  /** @inheritdoc */
  get provider(): string {
    return this._provider
  }

  /**
   * 统一非流式调用入口（对应文档 §2.1 结构化返回建议）。
   *
   * 接受标准 LLMMessage[]，直接构造 OpenAI Chat Completions payload，
   * 返回结构化 LLMResult（含 content / usage / toolCalls / finishReason / raw）。
   *
   * 与旧版 reason() 的差异：
   *   - 入参从 (prompt, context) 改为 LLMMessage[]
   *   - 返回从三元组 [content, usage, toolCalls] 改为 LLMResult 对象
   *   - 内部发布 LLM.COST 事件，统一采集 token 用量
   *   - 应用 bindTools 绑定的工具与 withRetry 配置的重试
   */
  async invoke(
    messages: LLMMessage[],
    options: LLMInvokeOptions = {},
  ): Promise<LLMResult> {
    const model = options.model ?? this._defaultModel
    const temperature = this._resolveTemperature(options as Record<string, any>)
    const maxTokens = this._resolveMaxTokens(options as Record<string, any>)
    const tools = options.tools ?? this._boundTools

    const url = `${this._baseUrl}/chat/completions`
    const headers = this._buildHeaders()
    const payload: Record<string, any> = {
      model,
      messages: messages.map(this._serializeMessage),
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }
    if (tools && tools.length > 0) {
      payload['tools'] = tools
    }

    const data = await this._doFetchWithRetry(url, headers, payload)

    const choices = (data['choices'] ?? [{}]) as Array<Record<string, any>>
    const message = (choices[0]?.['message'] ?? {}) as Record<string, any>
    const content = ((message['content'] ?? '') as string) || ''
    const finishReason = (choices[0]?.['finish_reason'] ?? 'stop') as string
    const rawToolCalls = (message['tool_calls'] ?? []) as Array<Record<string, any>>

    const usageData = (data['usage'] ?? {}) as Record<string, any>
    const usage = {
      prompt_tokens: usageData['prompt_tokens'] ?? 0,
      completion_tokens: usageData['completion_tokens'] ?? 0,
      total_tokens: usageData['total_tokens'] ?? 0,
    }

    const toolCalls: LLMToolCall[] = []
    for (const tc of rawToolCalls) {
      try {
        const func = (tc['function'] ?? {}) as Record<string, any>
        const tcName = (func['name'] ?? '') as string
        const argsStr = func['arguments'] ?? '{}'
        const args = typeof argsStr === 'string' ? JSON.parse(argsStr) : argsStr
        const tcId = (tc['id'] ?? '') as string
        if (tcName) {
          toolCalls.push({ id: tcId, name: tcName, arguments: args })
        }
      } catch (e) {
        logger.warning('Failed to parse tool_call arguments: %s', String(e))
      }
    }

    // 统一采集 token 用量，发布 LLM.COST 事件（失败静默，不影响主流程）
    await publish_llm_cost_event(usage, {
      provider: this._provider,
      model,
      sessionId: options.sessionId,
      userId: options.userId,
      traceId: options.traceId,
      taskType: options.taskType,
    })

    logger.debug(
      'LLM invoke: model=%s tokens=%d tool_calls=%d finish=%s',
      data['model'] ?? model, usage.total_tokens, toolCalls.length, finishReason,
    )

    return {
      content,
      usage,
      toolCalls,
      finishReason,
      raw: data,
    }
  }

  /** @inheritdoc */
  async *stream(
    messages: LLMMessage[],
    options: LLMInvokeOptions = {},
  ): AsyncGenerator<string, void, unknown> {
    const model = options.model ?? this._defaultModel
    const temperature = this._resolveTemperature(options as Record<string, any>)
    const maxTokens = this._resolveMaxTokens(options as Record<string, any>)
    const url = `${this._baseUrl}/chat/completions`
    const headers = this._buildHeaders()
    const payload: Record<string, any> = {
      model,
      messages: messages.map(this._serializeMessage),
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }

    const response = await this._doFetchRaw(url, headers, payload)

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
   * 绑定工具，返回新实例（不可变语义）。
   *
   * 由于 BaseLLMReasoner 持有连接池等状态，这里采用浅克隆方式：
   *   - 共享 _apiKey / _baseUrl / _dispatcher 等不可变状态
   *   - 独立 _boundTools（避免实例间污染）
   */
  bindTools(tools: any[]): ModuLLM {
    const cloned = this._shallowClone()
    cloned._boundTools = tools
    return cloned
  }

  /**
   * 应用重试包装，返回新实例。
   *
   * 重试逻辑在 invoke 内部执行（_doFetchWithRetry），
   * 此方法仅记录重试配置，不改变 invoke 签名。
   */
  withRetry(opts: LLMRetryOptions = {}): ModuLLM {
    const cloned = this._shallowClone()
    const merged: LLMRetryOptions = {
      maxAttempts: opts.maxAttempts ?? this._resolveRetryMaxAttempts(),
      baseDelay: opts.baseDelay ?? 0.5,
      maxDelay: opts.maxDelay ?? 5.0,
    }
    cloned._retryOpts = merged
    return cloned
  }

  /**
   * 浅克隆实例（用于 bindTools / withRetry 的不可变语义）。
   *
   * 子类如有额外字段，应覆盖此方法补充克隆逻辑。
   */
  protected _shallowClone(): BaseLLMReasoner {
    const cloned = Object.create(this.constructor.prototype) as BaseLLMReasoner
    // 共享不可变状态
    cloned._apiKey = this._apiKey
    cloned._baseUrl = this._baseUrl
    cloned._defaultModel = this._defaultModel
    cloned._timeout = this._timeout
    cloned._systemPrompt = this._systemPrompt
    cloned._provider = this._provider
    cloned._dispatcher = this._dispatcher  // 共享连接池
    // 独立可变状态（bindTools / withRetry 会覆盖）
    cloned._boundTools = this._boundTools
    cloned._retryOpts = this._retryOpts
    return cloned
  }

  /**
   * 序列化 LLMMessage 为 OpenAI 协议消息对象。
   */
  private _serializeMessage(msg: LLMMessage): Record<string, any> {
    const out: Record<string, any> = { role: msg.role, content: msg.content }
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      out['tool_calls'] = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }))
    }
    if (msg.tool_call_id) {
      out['tool_call_id'] = msg.tool_call_id
    }
    if (msg.metadata) {
      for (const [k, v] of Object.entries(msg.metadata)) {
        if (!(k in out)) out[k] = v
      }
    }
    return out
  }

  /**
   * 带重试的 fetch 调用。
   *
   * 应用 _retryOpts 配置的指数退避重试，仅重试可重试异常（网络错误 / 429 / 5xx）。
   */
  private async _doFetchWithRetry(
    url: string,
    headers: Record<string, string>,
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const retryOpts = this._retryOpts
    const maxAttempts = retryOpts?.maxAttempts ?? 1
    const baseDelay = retryOpts?.baseDelay ?? 0.5
    const maxDelay = retryOpts?.maxDelay ?? 5.0

    let lastExc: any = null
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this._doFetchRaw(url, headers, payload)
        if (!response.ok) {
          const err: any = new Error(`HTTP ${response.status}: ${response.statusText}`)
          err.status = response.status
          if (!isRetryableException(err)) {
            throw err
          }
          lastExc = err
        } else {
          return (await response.json()) as Record<string, any>
        }
      } catch (e: any) {
        if (!isRetryableException(e)) {
          throw e
        }
        lastExc = e
      }
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
        logger.warning(
          'LLM fetch attempt %d/%d failed (%s), retrying in %.2fs',
          attempt + 1, maxAttempts, lastExc?.message?.slice(0, 120) ?? 'unknown', delay,
        )
        await new Promise((resolve) => setTimeout(resolve, delay * 1000))
      }
    }
    throw lastExc ?? new Error('LLM fetch retry loop exited unexpectedly')
  }

  /**
   * 执行单次 fetch 请求（带超时与可选 dispatcher）。
   */
  private async _doFetchRaw(
    url: string,
    headers: Record<string, string>,
    payload: Record<string, any>,
  ): Promise<Response> {
    const fetchOpts: any = {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this._timeout * 1000),
    }
    if (this._dispatcher) {
      fetchOpts.dispatcher = this._dispatcher
    }
    return fetch(url, fetchOpts)
  }

  /**
   * 解析重试最大次数（从 RuntimeConfig 读取，缓存到 _retryOpts）。
   */
  private _resolveRetryMaxAttempts(): number {
    try {
      return parseInt(String(getConfig().get('llm.retry.max_attempts', 2)), 10)
    } catch {
      return 2
    }
  }

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
   * 同步推理（旧接口，保留向后兼容）。
   *
   * @deprecated 建议使用 invoke() 替代。invoke 返回结构化 LLMResult 对象，
   *             支持成本核算与统一异常处理。本方法将在下一个大版本移除。
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

    // 旧接口直接走 _doFetchRaw（不应用 _retryOpts，保持原行为）
    const response = await this._doFetchRaw(url, headers, payload)

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
   * 异步推理（旧接口，保留向后兼容）。
   *
   * @deprecated 建议使用 invoke() 替代。本方法将在下一个大版本移除。
   *
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
   * 异步流式推理（旧接口，保留向后兼容）。
   *
   * @deprecated 建议使用 stream() 替代。本方法将在下一个大版本移除。
   *
   * 内部将 (prompt, context) 转换为 LLMMessage[] 后委托新 stream() 实现。
   */
  async *astream(
    prompt: string,
    context: Record<string, any>,
    kwargs: Record<string, any> = {},
  ): AsyncGenerator<string, void, unknown> {
    // 将旧式 (prompt, context) 转换为 LLMMessage[]
    const legacyMessages = this._buildMessages(prompt, context)
    const llmMessages: LLMMessage[] = legacyMessages.map((m) => ({
      role: m['role'] as LLMMessage['role'],
      content: m['content'],
    }))
    yield* this.stream(llmMessages, kwargs as LLMInvokeOptions)
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
