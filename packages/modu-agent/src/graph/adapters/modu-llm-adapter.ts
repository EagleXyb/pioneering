// LangChain ChatOpenAI → ModuLLM 接口适配器
//
// 对应文档 §2.1 统一 LLM 接口建议：
//   将 LangChain ChatOpenAI（主流程实际使用路径）包装为 ModuLLM 接口实现，
//   使调用方统一面向 ModuLLM 接口编程，消除与 BaseLLMReasoner 的鸭子类型适配。
//
// 与 BaseLLMReasoner 的关系：
//   - 两者均实现 ModuLLM 接口
//   - BaseLLMReasoner 为自研轻量封装（@deprecated），本适配器为推荐路径
//   - 成本核算逻辑共享 cost-tracker.ts，避免漂移
import type {
  LLMInvokeOptions,
  LLMMessage,
  LLMResult,
  LLMRetryOptions,
  LLMToolCall,
  LLMUsage,
  ModuLLM,
} from '../../core/interfaces/llm.js'
import { publish_llm_cost_event } from '../../reasoning/llm/cost-tracker.js'
import { isRetryableException } from './retry.js'

// LangChain 消息类型缓存（避免每次 invoke 动态 import）
let _lcMessages: any = null
async function _loadLcMessages(): Promise<any> {
  if (_lcMessages === null) {
    _lcMessages = await import('@langchain/core/messages')
  }
  return _lcMessages
}

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[modu-llm-adapter] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[modu-llm-adapter] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[modu-llm-adapter] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[modu-llm-adapter] ${msg}`, ...args),
}

/**
 * 将 LLMMessage 转换为 LangChain BaseMessage。
 *
 * 依赖 LangChain 消息类（SystemMessage/HumanMessage/AIMessage/ToolMessage）。
 */
async function _toLcMessage(msg: LLMMessage): Promise<any> {
  const { SystemMessage, HumanMessage, AIMessage, ToolMessage } = await _loadLcMessages()
  switch (msg.role) {
    case 'system':
      return new SystemMessage(msg.content)
    case 'user':
      return new HumanMessage(msg.content)
    case 'assistant': {
      const tc = msg.tool_calls?.map((c) => ({
        id: c.id,
        name: c.name,
        args: c.arguments,
      }))
      return new AIMessage({ content: msg.content, tool_calls: tc })
    }
    case 'tool':
      return new ToolMessage({ content: msg.content, tool_call_id: msg.tool_call_id ?? '' })
    default:
      return new HumanMessage(msg.content)
  }
}

/**
 * 从 LangChain AIMessage 解析 token 用量。
 *
 * LangChain 0.2+ 在 AIMessage.usage_metadata 中提供标准化的 token 用量。
 * 旧版本或部分 Provider 可能不填充此字段，返回零值。
 */
function _extractUsage(aiMessage: any): LLMUsage {
  const um = aiMessage?.usage_metadata
  if (um && typeof um === 'object') {
    return {
      prompt_tokens: um.input_tokens ?? 0,
      completion_tokens: um.output_tokens ?? 0,
      total_tokens: um.total_tokens ?? 0,
    }
  }
  // 兜底：从 response_metadata.token_usage 提取（OpenAI 协议）
  const tu = aiMessage?.response_metadata?.token_usage
  if (tu && typeof tu === 'object') {
    return {
      prompt_tokens: tu.prompt_tokens ?? 0,
      completion_tokens: tu.completion_tokens ?? 0,
      total_tokens: tu.total_tokens ?? 0,
    }
  }
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
}

/**
 * 从 LangChain AIMessage 解析工具调用列表。
 */
function _extractToolCalls(aiMessage: any): LLMToolCall[] {
  const tcs = aiMessage?.tool_calls
  if (!Array.isArray(tcs) || tcs.length === 0) {
    return []
  }
  return tcs.map((tc: any) => ({
    id: tc.id ?? '',
    name: tc.name ?? '',
    arguments: tc.args ?? {},
  }))
}

/**
 * LangChain ChatOpenAI 的 ModuLLM 适配器。
 *
 * 包装 ChatOpenAI 实例，对外暴露统一 ModuLLM 接口。
 * 调用方通过 ModuLLM 接口消费，无需感知底层是 ChatOpenAI 还是 BaseLLMReasoner。
 *
 * 设计要点：
 *   - bindTools / withRetry 返回新适配器实例（不可变语义，与 BaseLLMReasoner 一致）
 *   - invoke 内部发布 LLM.COST 事件，统一采集 token 用量
 *   - 重试逻辑优先使用 LangChain withRetry，降级为手动重试
 */
export class ModuLLMAdapter implements ModuLLM {
  private _llm: any
  private _provider: string
  private _model: string
  private _retryOpts: LLMRetryOptions | null = null

  constructor(llm: any, provider: string = 'unknown', model: string = '') {
    this._llm = llm
    this._provider = provider
    this._model = model || llm?.model || ''
  }

  get model(): string {
    return this._model
  }

  get provider(): string {
    return this._provider
  }

  /** 暴露底层 LangChain ChatModel 实例（供需要 LangChain 原生 API 的场景使用） */
  get underlying(): any {
    return this._llm
  }

  async invoke(
    messages: LLMMessage[],
    options: LLMInvokeOptions = {},
  ): Promise<LLMResult> {
    const lcMessages = await Promise.all(messages.map(_toLcMessage))

    // 构造调用参数
    const invokeOpts: Record<string, any> = {}
    if (options.temperature !== undefined) invokeOpts.temperature = options.temperature
    if (options.maxTokens !== undefined) invokeOpts.maxTokens = options.maxTokens
    if (options.model !== undefined) invokeOpts.model = options.model

    let aiMessage: any
    if (this._retryOpts && this._retryOpts.maxAttempts && this._retryOpts.maxAttempts > 1) {
      aiMessage = await this._invokeWithRetry(lcMessages, invokeOpts)
    } else {
      aiMessage = await this._llm.invoke(lcMessages, invokeOpts)
    }

    const content = (aiMessage?.content ?? '') as string
    const usage = _extractUsage(aiMessage)
    const toolCalls = _extractToolCalls(aiMessage)
    const finishReason = (aiMessage?.response_metadata?.finish_reason ?? 'stop') as string

    // 统一采集 token 用量，发布 LLM.COST 事件
    await publish_llm_cost_event(usage, {
      provider: this._provider,
      model: this._model,
      sessionId: options.sessionId,
      userId: options.userId,
      traceId: options.traceId,
      taskType: options.taskType,
    })

    logger.debug(
      'LLM invoke: model=%s tokens=%d tool_calls=%d finish=%s',
      this._model, usage.total_tokens, toolCalls.length, finishReason,
    )

    return {
      content,
      usage,
      toolCalls,
      finishReason,
      raw: aiMessage,
    }
  }

  async *stream(
    messages: LLMMessage[],
    options: LLMInvokeOptions = {},
  ): AsyncGenerator<string, void, unknown> {
    const lcMessages = await Promise.all(messages.map(_toLcMessage))
    const invokeOpts: Record<string, any> = {}
    if (options.temperature !== undefined) invokeOpts.temperature = options.temperature
    if (options.maxTokens !== undefined) invokeOpts.maxTokens = options.maxTokens
    if (options.model !== undefined) invokeOpts.model = options.model

    const stream = await this._llm.stream(lcMessages, invokeOpts)
    for await (const chunk of stream) {
      const content = chunk?.content
      if (content) {
        yield content as string
      }
    }
  }

  bindTools(tools: any[]): ModuLLM {
    // ChatOpenAI.bindTools 返回新的 Runnable，不是 ChatOpenAI 实例
    // 但仍保持 invoke/stream/withRetry 接口，可直接包装
    const bound = this._llm.bindTools(tools)
    const adapter = new ModuLLMAdapter(bound, this._provider, this._model)
    adapter._retryOpts = this._retryOpts
    return adapter
  }

  withRetry(opts: LLMRetryOptions = {}): ModuLLM {
    const merged: LLMRetryOptions = {
      maxAttempts: opts.maxAttempts ?? this._retryOpts?.maxAttempts ?? 2,
      baseDelay: opts.baseDelay ?? this._retryOpts?.baseDelay ?? 0.5,
      maxDelay: opts.maxDelay ?? this._retryOpts?.maxDelay ?? 5.0,
    }

    // 优先尝试 LangChain 原生 withRetry
    let wrapped: any
    try {
      if (typeof this._llm.withRetry === 'function') {
        wrapped = this._llm.withRetry({
          stopAfterAttempt: merged.maxAttempts,
          onFailedAttempt: (error: any) => {
            if (!isRetryableException(error)) {
              throw error
            }
            logger.warning(
              'LLM attempt failed (%s), will retry',
              error?.constructor?.name ?? 'Error',
            )
          },
        })
      } else {
        wrapped = this._llm
      }
    } catch (e) {
      logger.warning('Failed to apply LangChain withRetry, falling back to manual retry: %s', String(e))
      wrapped = this._llm
    }

    const adapter = new ModuLLMAdapter(wrapped, this._provider, this._model)
    adapter._retryOpts = merged
    return adapter
  }

  /**
   * 手动重试包装（LangChain withRetry 不可用时的降级路径）。
   */
  private async _invokeWithRetry(
    lcMessages: any[],
    invokeOpts: Record<string, any>,
  ): Promise<any> {
    const maxAttempts = this._retryOpts?.maxAttempts ?? 2
    const baseDelay = this._retryOpts?.baseDelay ?? 0.5
    const maxDelay = this._retryOpts?.maxDelay ?? 5.0

    let lastExc: any = null
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this._llm.invoke(lcMessages, invokeOpts)
      } catch (e: any) {
        if (!isRetryableException(e)) {
          throw e
        }
        lastExc = e
        if (attempt < maxAttempts - 1) {
          const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
          logger.warning(
            'LLM invoke attempt %d/%d failed (%s), retrying in %.2fs',
            attempt + 1, maxAttempts, e?.constructor?.name ?? 'Error', delay,
          )
          await new Promise((resolve) => setTimeout(resolve, delay * 1000))
        }
      }
    }
    throw lastExc ?? new Error('LLM invoke retry loop exited unexpectedly')
  }
}

/**
 * 从 LangChain ChatOpenAI 实例构造 ModuLLM 适配器。
 *
 * 与 build_chat_model 配合使用：
 *   const chatModel = build_chat_model('glm', config)
 *   const moduLlm = wrap_chat_model_as_modu(chatModel, 'glm')
 *
 * @param llm      LangChain ChatOpenAI 实例
 * @param provider Provider 标识
 */
export function wrap_chat_model_as_modu(
  llm: any,
  provider: string = 'unknown',
): ModuLLM {
  return new ModuLLMAdapter(llm, provider, llm?.model ?? '')
}
