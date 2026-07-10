// 对应 Python: config/schemas.py
// 数据校验 schema（dataclass → TS class 等价实现）
// 注意：原 Python 用 dataclass __post_init__ 校验，TS 在构造函数中校验。

/**
 * 感知输入 schema。
 * 对应 Python PerceptionInputSchema。
 */
export class PerceptionInputSchema {
  inputType: string
  rawContent: Uint8Array
  language: string | null
  sensitivityLevel: number

  static readonly REQUIRED_FIELDS = new Set(['input_type', 'raw_content'])

  constructor(opts: {
    inputType?: string
    rawContent?: Uint8Array
    language?: string | null
    sensitivityLevel?: number
  } = {}) {
    this.inputType = opts.inputType ?? 'text'
    this.rawContent = opts.rawContent ?? new Uint8Array()
    this.language = opts.language ?? null
    this.sensitivityLevel = opts.sensitivityLevel ?? 0

    if (!['text', 'image', 'audio'].includes(this.inputType)) {
      throw new ValueError(`Invalid input_type: ${this.inputType}, must be text/image/audio`)
    }
    if (!(0 <= this.sensitivityLevel && this.sensitivityLevel <= 5)) {
      throw new ValueError('sensitivity_level must be between 0 and 5')
    }
  }

  toDict(): Record<string, any> {
    return {
      input_type: this.inputType,
      raw_content: this.rawContent
        ? Array.from(this.rawContent).map((b) => b.toString(16).padStart(2, '0')).join('')
        : '',
      language: this.language,
      sensitivity_level: this.sensitivityLevel,
    }
  }

  static fromDict(data: Record<string, any>): PerceptionInputSchema {
    let raw = data.raw_content ?? new Uint8Array()
    if (typeof raw === 'string' && raw) {
      const bytes = new Uint8Array(raw.length / 2)
      for (let i = 0; i < raw.length; i += 2) {
        bytes[i / 2] = parseInt(raw.slice(i, i + 2), 16)
      }
      raw = bytes
    }
    return new PerceptionInputSchema({
      inputType: data.input_type ?? 'text',
      rawContent: raw,
      language: data.language,
      sensitivityLevel: data.sensitivity_level ?? 0,
    })
  }
}

/**
 * 感知输出 schema。
 * 对应 Python PerceptionOutputSchema。
 */
export class PerceptionOutputSchema {
  parsedContent: Record<string, any>
  detectedLanguage: string | null
  confidence: number
  metadata: Record<string, string>

  // 语义理解字段（P0 扩展）
  intent: Record<string, number> | null
  entities: Array<Record<string, string>>
  sentiment: Record<string, number> | null
  qualityScore: number
  languageMixed: boolean
  languageDistribution: Record<string, number> | null
  securityScore: number

  constructor(opts: {
    parsedContent?: Record<string, any>
    detectedLanguage?: string | null
    confidence?: number
    metadata?: Record<string, string>
    intent?: Record<string, number> | null
    entities?: Array<Record<string, string>>
    sentiment?: Record<string, number> | null
    qualityScore?: number
    languageMixed?: boolean
    languageDistribution?: Record<string, number> | null
    securityScore?: number
  } = {}) {
    this.parsedContent = opts.parsedContent ?? {}
    this.detectedLanguage = opts.detectedLanguage ?? null
    this.confidence = opts.confidence ?? 0.0
    this.metadata = opts.metadata ?? {}
    this.intent = opts.intent ?? null
    this.entities = opts.entities ?? []
    this.sentiment = opts.sentiment ?? null
    this.qualityScore = opts.qualityScore ?? 0.0
    this.languageMixed = opts.languageMixed ?? false
    this.languageDistribution = opts.languageDistribution ?? null
    this.securityScore = opts.securityScore ?? 1.0
  }

  toDict(): Record<string, any> {
    return {
      parsed_content: this.parsedContent,
      detected_language: this.detectedLanguage,
      confidence: this.confidence,
      metadata: this.metadata,
      intent: this.intent,
      entities: this.entities,
      sentiment: this.sentiment,
      quality_score: this.qualityScore,
      language_mixed: this.languageMixed,
      language_distribution: this.languageDistribution,
      security_score: this.securityScore,
    }
  }
}

// P2-9: context_window 允许的取值
export const VALID_CONTEXT_WINDOWS = new Set([
  'last_1_turns', 'last_3_turns', 'last_5_turns', 'last_10_turns', 'all',
])

export function isValidContextWindow(value: string): boolean {
  if (VALID_CONTEXT_WINDOWS.has(value)) return true
  if (value.startsWith('last_') && value.endsWith('_turns')) {
    const numPart = value.slice('last_'.length, -'_turns'.length)
    return /^\d+$/.test(numPart) && parseInt(numPart, 10) >= 1
  }
  return false
}

/**
 * 记忆查询 schema。
 * 对应 Python MemoryQuerySchema。
 */
export class MemoryQuerySchema {
  userId: string
  contextWindow: string
  requiredFields: string[]
  enableCompression: boolean

  static readonly REQUIRED_FIELDS = new Set(['user_id', 'context_window', 'required_fields'])

  constructor(opts: {
    userId?: string
    contextWindow?: string
    requiredFields?: string[]
    enableCompression?: boolean
  } = {}) {
    this.userId = opts.userId ?? ''
    this.contextWindow = opts.contextWindow ?? 'last_5_turns'
    this.requiredFields = opts.requiredFields ?? []
    this.enableCompression = opts.enableCompression ?? false

    if (!this.userId) throw new ValueError('user_id is required')
    if (!this.contextWindow) throw new ValueError('context_window is required')
    if (!this.requiredFields) throw new ValueError('required_fields must be explicitly declared')
    if (!isValidContextWindow(this.contextWindow)) {
      throw new ValueError(
        `Invalid context_window: '${this.contextWindow}', ` +
        `must be one of ${[...VALID_CONTEXT_WINDOWS].sort()} or 'last_<N>_turns'`,
      )
    }
  }

  toDict(): Record<string, any> {
    return {
      user_id: this.userId,
      context_window: this.contextWindow,
      required_fields: this.requiredFields,
      enable_compression: this.enableCompression,
    }
  }

  static fromDict(data: Record<string, any>): MemoryQuerySchema {
    return new MemoryQuerySchema({
      userId: data.user_id ?? '',
      contextWindow: data.context_window ?? 'last_5_turns',
      requiredFields: data.required_fields ?? [],
      enableCompression: data.enable_compression ?? false,
    })
  }
}

/**
 * 记忆更新 schema。
 */
export class MemoryUpdateSchema {
  userId: string
  newData: Record<string, any>
  metadata: Record<string, any>
  mode: string

  constructor(opts: {
    userId?: string
    newData?: Record<string, any>
    metadata?: Record<string, any>
    mode?: string
  } = {}) {
    this.userId = opts.userId ?? ''
    this.newData = opts.newData ?? {}
    this.metadata = opts.metadata ?? {}
    this.mode = opts.mode ?? 'incremental'

    if (!this.userId) throw new ValueError('user_id is required')
    if (!['incremental', 'overwrite'].includes(this.mode)) {
      throw new ValueError(`Invalid mode: ${this.mode}, must be incremental/overwrite`)
    }
  }
}

/**
 * 工具调用 schema。
 */
export class ToolCallSchema {
  toolName: string
  parameters: Record<string, any>
  timeoutMs: number
  requiredFields: string[]

  static readonly REQUIRED_FIELDS = new Set(['tool_name', 'parameters'])

  constructor(opts: {
    toolName?: string
    parameters?: Record<string, any>
    timeoutMs?: number
    requiredFields?: string[]
  } = {}) {
    this.toolName = opts.toolName ?? ''
    this.parameters = opts.parameters ?? {}
    this.timeoutMs = opts.timeoutMs ?? 1800000
    this.requiredFields = opts.requiredFields ?? []

    if (!this.toolName) throw new ValueError('tool_name is required')
  }

  toDict(): Record<string, any> {
    return {
      tool_name: this.toolName,
      parameters: this.parameters,
      timeout_ms: this.timeoutMs,
      required_fields: this.requiredFields,
    }
  }
}

/**
 * 工具结果 schema。
 */
export class ToolResultSchema {
  status: string
  errorCode: string
  data: Record<string, any>

  constructor(opts: {
    status?: string
    errorCode?: string
    data?: Record<string, any>
  } = {}) {
    this.status = opts.status ?? 'success'
    this.errorCode = opts.errorCode ?? ''
    this.data = opts.data ?? {}
  }

  isSuccess(): boolean {
    return this.status === 'success'
  }

  toDict(): Record<string, any> {
    return {
      status: this.status,
      error_code: this.errorCode,
      data: this.data,
    }
  }
}

/**
 * LLM 调用 schema。
 */
export class LLMCallSchema {
  prompt: string
  context: Record<string, any>
  temperature: number
  maxTokens: number

  constructor(opts: {
    prompt?: string
    context?: Record<string, any>
    temperature?: number
    maxTokens?: number
  } = {}) {
    this.prompt = opts.prompt ?? ''
    this.context = opts.context ?? {}
    this.temperature = opts.temperature ?? 0.7
    this.maxTokens = opts.maxTokens ?? 512

    if (!this.prompt) throw new ValueError('prompt is required')
    if (!(0.0 <= this.temperature && this.temperature <= 2.0)) {
      throw new ValueError('temperature must be between 0.0 and 2.0')
    }
    if (this.maxTokens <= 0) throw new ValueError('max_tokens must be positive')
  }
}

/**
 * LLM 结果 schema。
 */
export class LLMResultSchema {
  content: string
  model: string
  tokensUsed: number
  finishReason: string

  constructor(opts: {
    content?: string
    model?: string
    tokensUsed?: number
    finishReason?: string
  } = {}) {
    this.content = opts.content ?? ''
    this.model = opts.model ?? ''
    this.tokensUsed = opts.tokensUsed ?? 0
    this.finishReason = opts.finishReason ?? ''
  }
}

/**
 * 反馈信号 schema。
 */
export class FeedbackSignalSchema {
  source: string
  metricName: string
  value: number
  threshold: number
  triggered: boolean
  metadata: Record<string, any>

  constructor(opts: {
    source?: string
    metricName?: string
    value?: number
    threshold?: number
    triggered?: boolean
    metadata?: Record<string, any>
  } = {}) {
    this.source = opts.source ?? ''
    this.metricName = opts.metricName ?? ''
    this.value = opts.value ?? 0.0
    this.threshold = opts.threshold ?? 0.0
    this.triggered = opts.triggered ?? false
    this.metadata = opts.metadata ?? {}
  }
}

/** 轻量 ValueError（对应 Python ValueError）。 */
export class ValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValueError'
  }
}
