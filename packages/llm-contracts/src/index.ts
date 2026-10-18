// LLM 接入层公共契约（P1）
//
// 设计约束：
//   - 纯类型 + 极少量纯函数，不依赖 node / electron / 任何 SDK；
//   - 上层（core / adapters / gateway / 各宿主）只依赖本包的类型，避免互相耦合；
//   - 字段命名区分「别名（alias）」与「真实模型 ID（model_id）」，
//     前者面向客户端与配置，后者只出现在请求上游时。

/** 模型能力标签。 */
export type ModelCapability =
  | 'tools'
  | 'vision'
  | 'reasoning'
  | 'json_mode'
  | 'long_context'

/** 模型可用状态。 */
export type ModelStatus = 'active' | 'degraded' | 'sunset'

/**
 * 价格（相对单位，沿用现有目录语义：每百万 token 的输入/输出单价）。
 * 保留 input_price / output_price 命名，避免破坏 /system/models 的前端契约。
 */
export interface ModelPricing {
  input_price?: number
  output_price?: number
}

/** 模型目录项：别名解析与调用的唯一依据。 */
export interface ModelDescriptor {
  /** 客户端与配置使用的别名，如 fast / reasoning */
  alias: string
  /** 发往上游的真实模型 ID，如 deepseek-flash */
  model_id: string
  /** 供应商标识，如 deepseek / openai / zhipu / dashscope */
  provider: string
  /** 展示名 */
  display_name: string
  description?: string
  capabilities: readonly ModelCapability[]
  /** 上下文窗口（token） */
  context_window?: number
  /** 单次最大输出（token） */
  max_output?: number
  pricing?: ModelPricing
  status?: ModelStatus
  /** 不可用原因（status != active 时必填） */
  disable_reason?: string
}

/** 对话消息（仅保留接入层需要的字段）。 */
export interface ChatMessage {
  role: string
  content: string
}

/** 一次补全请求。 */
export interface ChatRequest {
  messages: ChatMessage[]
  /** 别名或真实模型 ID；省略时使用默认别名 */
  model?: string | null
  temperature?: number | null
  maxTokens?: number | null
  /** 外部中止信号（用户停止生成等） */
  signal?: AbortSignal | null
}

/** token 用量。 */
export interface ChatUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/**
 * 流式增量事件（只描述模型输出，不涉及 AG-UI / SSE 等传输格式）。
 *
 * 适配器只产出 content / reasoning；usage 与 done 由网关在收尾时补发，
 * 这样适配器无需关心计量与生命周期。
 */
export type ChatStreamEvent =
  | { type: 'content'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'usage'; usage: ChatUsage; costUsd?: number }
  | { type: 'done'; finishReason?: string }

/** 一次补全的最终结果。 */
export interface ChatResult {
  content: string
  reasoning?: string
  usage?: ChatUsage
  finishReason?: string
  /** 由网关按目录价格估算的成本（美元） */
  costUsd?: number
}

/** 统一错误码。 */
export type LLMErrorCode =
  | 'INVALID_MODEL'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'BAD_RESPONSE'
  | 'ABORTED'
  | 'CIRCUIT_OPEN'

const RETRYABLE_CODES: ReadonlySet<LLMErrorCode> = new Set<LLMErrorCode>([
  'RATE_LIMITED',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_ERROR',
])

export interface LLMErrorOptions {
  status?: number
  retryable?: boolean
  cause?: unknown
}

/**
 * 接入层统一错误。
 *
 * 关键点：把「网络错误 / HTTP 状态 / 协议异常」收敛为有限错误码，
 * 上层（路由、前端）只需按下发的 code 决定重试或提示，不再解析原始响应体。
 */
export class LLMError extends Error {
  readonly code: LLMErrorCode
  readonly status?: number
  readonly retryable: boolean

  constructor(code: LLMErrorCode, message: string, opts: LLMErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'LLMError'
    this.code = code
    this.status = opts.status
    this.retryable = opts.retryable ?? RETRYABLE_CODES.has(code)
  }

  static is(e: unknown): e is LLMError {
    return e instanceof LLMError || (typeof e === 'object' && e !== null && (e as any).name === 'LLMError')
  }
}

/** 把未知异常归一化为 LLMError。 */
export function toLLMError(e: unknown): LLMError {
  if (LLMError.is(e)) return e
  const err = e as { name?: string; message?: string } | null
  if (err?.name === 'AbortError') {
    return new LLMError('ABORTED', '请求已中止', { cause: e })
  }
  return new LLMError('UPSTREAM_ERROR', err?.message ? String(err.message) : String(e), {
    cause: e,
  })
}

/** 判断异常是否值得重试。 */
export function isRetryable(e: unknown): boolean {
  return LLMError.is(e) ? e.retryable : false
}
