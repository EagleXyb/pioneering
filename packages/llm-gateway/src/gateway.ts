// LLM Gateway：接入层唯一出入口（P1）
//
// 职责边界：
//   - 解析别名 → 模型描述（ModelCatalog）
//   - 取供应商配置（由宿主注入，网关自身不读环境变量）
//   - 套用超时 / 重试 / 熔断 / 成本核算
//   - 统一错误码，向上只暴露有限语义
// 不负责：AG-UI / SSE 编码、鉴权、配额（分别属于路由层与宿主）。
import {
  LLMError,
  toLLMError,
  type ChatRequest,
  type ChatResult,
  type ChatStreamEvent,
  type ChatUsage,
  type ModelDescriptor,
} from '@pioneering/llm-contracts'
import {
  CircuitBreaker,
  ModelCatalog,
  backoffDelay,
  computeCost,
  createIdleTimeout,
  mergeUsage,
  sleep,
  withRetry,
} from '@pioneering/llm-core'
import { createOpenAICompatibleAdapter } from '@pioneering/llm-adapters'

/** 供应商连接配置（由宿主从密钥服务 / 环境变量解析后注入）。 */
export interface ProviderConfig {
  apiKey: string
  baseUrl: string
  headers?: Record<string, string>
}

/** 策略参数。 */
export interface GatewayPolicy {
  /** 流式空闲超时（毫秒，<=0 不限） */
  idleTimeoutMs?: number
  /** 非流式总超时（毫秒，<=0 不限） */
  requestTimeoutMs?: number
  /** 最大尝试次数（含首次） */
  maxAttempts?: number
  baseDelayMs?: number
  failureThreshold?: number
  cooldownMs?: number
}

/** 适配器接口：网关只依赖这一层抽象，便于替换协议与测试注入。 */
export interface ChatAdapter {
  complete(req: ChatRequest): Promise<ChatResult>
  stream(req: ChatRequest): AsyncGenerator<ChatStreamEvent, ChatResult, void>
}

export interface LLMGatewayOptions {
  models: readonly ModelDescriptor[]
  aliases?: Readonly<Record<string, string>>
  defaultAlias?: string
  resolveProvider: (model: ModelDescriptor) => ProviderConfig
  /** 自定义适配器工厂（默认走 OpenAI 兼容协议） */
  createAdapter?: (model: ModelDescriptor, provider: ProviderConfig) => ChatAdapter
  policy?: GatewayPolicy
  breaker?: CircuitBreaker
  fetchImpl?: typeof fetch
}

export interface CapabilityModel {
  alias: string
  model_id: string
  display_name: string
  description?: string
  provider: string
  capabilities: readonly string[]
  context_window: number | null
  max_output: number | null
  pricing?: { input_price?: number; output_price?: number }
  status: string
  disable_reason: string | null
}

export interface CapabilitiesResponse {
  version: number
  models: CapabilityModel[]
}

export class LLMGateway {
  readonly catalog: ModelCatalog

  private readonly _options: LLMGatewayOptions
  private readonly _policy: Required<
    Pick<GatewayPolicy, 'idleTimeoutMs' | 'requestTimeoutMs' | 'maxAttempts' | 'baseDelayMs'>
  >
  private readonly _breaker: CircuitBreaker

  constructor(options: LLMGatewayOptions) {
    if (!options.models.length) {
      throw new Error('LLMGateway: models 不能为空')
    }
    this._options = options
    this.catalog = new ModelCatalog({
      models: options.models,
      aliases: options.aliases,
      defaultAlias: options.defaultAlias,
    })
    this._policy = {
      idleTimeoutMs: options.policy?.idleTimeoutMs ?? 60_000,
      requestTimeoutMs: options.policy?.requestTimeoutMs ?? 120_000,
      maxAttempts: Math.max(1, options.policy?.maxAttempts ?? 2),
      baseDelayMs: Math.max(0, options.policy?.baseDelayMs ?? 300),
    }
    this._breaker =
      options.breaker ??
      new CircuitBreaker({
        failureThreshold: options.policy?.failureThreshold,
        cooldownMs: options.policy?.cooldownMs,
      })
  }

  /** 供 GET /capabilities 使用的目录视图（不含密钥与端点）。 */
  getCapabilities(): CapabilitiesResponse {
    return {
      version: 1,
      models: this.catalog.list().map((m) => ({
        alias: m.alias,
        model_id: m.model_id,
        display_name: m.display_name,
        description: m.description,
        provider: m.provider,
        capabilities: m.capabilities,
        context_window: m.context_window ?? null,
        max_output: m.max_output ?? null,
        pricing: m.pricing,
        status: m.status ?? 'active',
        disable_reason: m.disable_reason ?? null,
      })),
    }
  }

  /**
   * 流式补全。
   *
   * 事件顺序：content / reasoning 增量 → usage（若有）→ done。
   * 仅在「尚未产出任何增量」时重试，避免正文重复。
   */
  async *stream(req: ChatRequest): AsyncGenerator<ChatStreamEvent, ChatResult, void> {
    const model = this.catalog.resolve(req.model)
    const provider = this._resolveProvider(model)
    const adapter = this._adapter(model, provider)
    const idle = createIdleTimeout(this._policy.idleTimeoutMs, req.signal)

    let content = ''
    let reasoning = ''
    let usage: ChatUsage | undefined
    let finishReason: string | undefined
    let emitted = false
    let attempt = 0

    try {
      this._breaker.assertAvailable(model.provider)

      for (;;) {
        attempt += 1
        try {
          const it = adapter.stream({ ...req, model: model.model_id, signal: idle.signal })
          for (;;) {
            const step = await it.next()
            if (step.done) {
              usage = mergeUsage(usage, step.value.usage)
              finishReason = step.value.finishReason ?? finishReason
              break
            }
            idle.refresh()
            emitted = true
            if (step.value.type === 'content') content += step.value.delta
            else if (step.value.type === 'reasoning') reasoning += step.value.delta
            yield step.value
          }
          this._breaker.onSuccess(model.provider)
          break
        } catch (e) {
          const err = this._classify(e, idle.timedOut, req.signal)
          const canRetry =
            !emitted &&
            attempt < this._policy.maxAttempts &&
            err.retryable &&
            !req.signal?.aborted
          if (!canRetry) {
            // 用户主动中止不代表供应商异常，不能计入熔断失败
            if (err.code === 'ABORTED') this._breaker.onSuccess(model.provider)
            else this._breaker.onFailure(model.provider)
            throw err
          }
          await sleep(
            backoffDelay(attempt, this._policy.baseDelayMs, 3_000),
            req.signal,
          )
        }
      }

      if (usage) {
        yield { type: 'usage', usage, costUsd: computeCost(model, usage) }
      }
      yield { type: 'done', finishReason }

      return { content, reasoning, usage, finishReason, costUsd: computeCost(model, usage) }
    } finally {
      idle.dispose()
    }
  }

  /** 非流式补全（带总超时与重试）。 */
  async complete(req: ChatRequest): Promise<ChatResult> {
    const model = this.catalog.resolve(req.model)
    const provider = this._resolveProvider(model)
    const adapter = this._adapter(model, provider)
    const timeout = createIdleTimeout(this._policy.requestTimeoutMs, req.signal)

    try {
      this._breaker.assertAvailable(model.provider)

      const result = await withRetry(
        async () => {
          try {
            return await adapter.complete({
              ...req,
              model: model.model_id,
              signal: timeout.signal,
            })
          } catch (e) {
            throw this._classify(e, timeout.timedOut, req.signal)
          }
        },
        {
          maxAttempts: this._policy.maxAttempts,
          baseDelayMs: this._policy.baseDelayMs,
          signal: req.signal,
          // 已触发总超时不再重试，避免无意义的等待
          isRetryable: (e) => !timeout.timedOut && LLMError.is(e) && e.retryable,
        },
      )

      this._breaker.onSuccess(model.provider)
      return { ...result, costUsd: computeCost(model, result.usage) }
    } catch (e) {
      const code = LLMError.is(e) ? e.code : null
      if (code !== 'CIRCUIT_OPEN') {
        // 用户中止 = 供应商仍健康；仅真实失败计入熔断
        if (code === 'ABORTED') this._breaker.onSuccess(model.provider)
        else this._breaker.onFailure(model.provider)
      }
      throw e
    } finally {
      timeout.dispose()
    }
  }

  private _resolveProvider(model: ModelDescriptor): ProviderConfig {
    const provider = this._options.resolveProvider(model)
    if (!provider.apiKey) {
      // 不在此处抛错：交给上游返回 401，保留改造前的可观测行为
      console.warn(
        `[llm-gateway] provider '${model.provider}' 未配置 API Key（模型 ${model.model_id}）`,
      )
    }
    return provider
  }

  private _adapter(model: ModelDescriptor, provider: ProviderConfig): ChatAdapter {
    if (this._options.createAdapter) {
      return this._options.createAdapter(model, provider)
    }
    return createOpenAICompatibleAdapter({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      headers: provider.headers,
      fetchImpl: this._options.fetchImpl,
    })
  }

  private _classify(e: unknown, timedOut: boolean, external?: AbortSignal | null): LLMError {
    if (external?.aborted) {
      return new LLMError('ABORTED', '请求已中止', { cause: e })
    }
    if (timedOut) {
      // 超时后 signal 已永久中止，同一次请求内重试没有意义
      return new LLMError('UPSTREAM_TIMEOUT', 'LLM 响应超时', {
        cause: e,
        retryable: false,
      })
    }
    const err = toLLMError(e)
    // 适配器把任何 AbortError 视为 ABORTED；无外部中止时即为超时
    if (err.code === 'ABORTED') {
      return new LLMError('UPSTREAM_TIMEOUT', 'LLM 连接被中止', {
        cause: e,
        retryable: false,
      })
    }
    return err
  }
}

export function createLLMGateway(options: LLMGatewayOptions): LLMGateway {
  return new LLMGateway(options)
}
