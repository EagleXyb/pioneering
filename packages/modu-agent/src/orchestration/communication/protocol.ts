// 对应 Python: orchestration/communication/protocol.py
// AgentEvent + EventDomain + EventAction + EventPriority + ErrorCode 枚举 + 各类 DTO
import { randomUUID } from 'crypto'

// ============================================================
// 枚举（对应 Python str, Enum —— 使用 const object + 联合类型）
// ============================================================

export const EventDomain = {
  PERCEPTION: 'perception',
  REASONING: 'reasoning',
  MEMORY: 'memory',
  ACTION: 'action',
  FEEDBACK: 'feedback',
  TOOL: 'tool',
  NLP: 'nlp',
  VISION: 'vision',
  // P4 Plan-and-Execute 规划域事件
  PLAN: 'plan',
  // 统一 LLM 接口层成本核算事件（对应文档 §2.1 成本核算建议）
  LLM: 'llm',
} as const
export type EventDomain = (typeof EventDomain)[keyof typeof EventDomain]

export const EventAction = {
  QUERY: 'query',
  UPDATE: 'update',
  ANALYZE: 'analyze',
  ANALYZE_SCENE: 'analyze_scene',
  EXECUTE: 'execute',
  INVOKE: 'invoke',
  GENERATE: 'generate',
  STREAM: 'stream',
  REGISTER: 'register',
  NOTIFY: 'notify',
  // P3-12.3.1 多 Agent 协作共识事件
  CONSENSUS_REACHED: 'consensus_reached',
  CONSENSUS_FAILED: 'consensus_failed',
  // P3-12.3.2 Human-in-the-loop 审批事件
  HUMAN_REVIEW_REQUIRED: 'human_review_required',
  HUMAN_REVIEW_APPROVED: 'human_review_approved',
  HUMAN_REVIEW_REJECTED: 'human_review_rejected',
  // P4 Plan-and-Execute 规划与执行事件
  PLAN_CREATED: 'plan_created',
  STEP_STARTED: 'step_started',
  STEP_COMPLETED: 'step_completed',
  REPLANNED: 'replanned',
  // 统一 LLM 接口层成本核算事件（对应文档 §2.1 成本核算建议）
  COST: 'cost',
} as const
export type EventAction = (typeof EventAction)[keyof typeof EventAction]

export const EventPriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const
export type EventPriority = (typeof EventPriority)[keyof typeof EventPriority]

// ============================================================
// AgentEvent（对应 Python @dataclass AgentEvent）
// ============================================================

export interface AgentEventInit {
  event_id?: string
  trace_id?: string
  session_id?: string
  user_id?: string
  domain?: string
  action?: string
  timestamp?: Date
  payload?: Uint8Array
  metadata?: Record<string, string>
  priority?: EventPriority
}

export class AgentEvent {
  event_id: string
  trace_id: string
  session_id: string
  user_id: string
  domain: string
  action: string
  timestamp: Date
  payload: Uint8Array
  metadata: Record<string, string>
  priority: EventPriority

  constructor(init: AgentEventInit = {}) {
    this.event_id = init.event_id ?? randomUUID()
    this.trace_id = init.trace_id ?? ''
    this.session_id = init.session_id ?? ''
    this.user_id = init.user_id ?? ''
    this.domain = init.domain ?? ''
    this.action = init.action ?? ''
    this.timestamp = init.timestamp ?? new Date()
    this.payload = init.payload ?? new Uint8Array()
    this.metadata = init.metadata ?? {}
    this.priority = init.priority ?? EventPriority.NORMAL

    // __post_init__ 校验
    if (!this.trace_id) {
      this.trace_id = randomUUID()
    }
    if (!this.user_id) {
      throw new Error('user_id is required')
    }
    if (!this.session_id) {
      throw new Error('session_id is required')
    }
    if (!this.domain) {
      throw new Error('domain is required')
    }
    if (!this.action) {
      throw new Error('action is required')
    }
  }

  toDict(): Record<string, any> {
    return {
      event_id: this.event_id,
      trace_id: this.trace_id,
      session_id: this.session_id,
      user_id: this.user_id,
      domain: this.domain,
      action: this.action,
      timestamp: this.timestamp.toISOString(),
      payload: this.payload && this.payload.length > 0
        ? Buffer.from(this.payload).toString('hex')
        : '',
      metadata: this.metadata,
      priority: this.priority,
    }
  }

  static fromDict(data: Record<string, any>): AgentEvent {
    let ts: Date
    const rawTs = data.timestamp
    if (typeof rawTs === 'string') {
      ts = new Date(rawTs)
    } else if (rawTs instanceof Date) {
      ts = rawTs
    } else {
      ts = new Date()
    }

    let payload: Uint8Array = data.payload ?? new Uint8Array()
    if (typeof payload === 'string' && payload) {
      payload = new Uint8Array(Buffer.from(payload, 'hex'))
    }

    let priority: EventPriority = data.priority ?? EventPriority.NORMAL
    if (typeof priority === 'string') {
      priority = priority as EventPriority
    }

    return new AgentEvent({
      event_id: data.event_id ?? randomUUID(),
      trace_id: data.trace_id ?? '',
      session_id: data.session_id ?? '',
      user_id: data.user_id ?? '',
      domain: data.domain ?? '',
      action: data.action ?? '',
      timestamp: ts,
      payload,
      metadata: data.metadata ?? {},
      priority,
    })
  }
}

// ============================================================
// DTO 类（对应 Python @dataclass）
// ============================================================

export interface MemoryQueryRequestInit {
  context_window?: string
  required_fields?: string[]
  enable_compression?: boolean
}

export class MemoryQueryRequest {
  context_window: string
  required_fields: string[]
  enable_compression: boolean

  constructor(init: MemoryQueryRequestInit = {}) {
    this.context_window = init.context_window ?? 'last_5_turns'
    this.required_fields = init.required_fields ?? []
    this.enable_compression = init.enable_compression ?? false
  }

  toDict(): Record<string, any> {
    return {
      context_window: this.context_window,
      required_fields: this.required_fields,
      enable_compression: this.enable_compression,
    }
  }

  static fromDict(data: Record<string, any>): MemoryQueryRequest {
    return new MemoryQueryRequest({
      context_window: data.context_window ?? 'last_5_turns',
      required_fields: data.required_fields ?? [],
      enable_compression: data.enable_compression ?? false,
    })
  }
}

export interface MemoryQueryResponseInit {
  fields?: Record<string, any>
  compressed?: boolean
}

export class MemoryQueryResponse {
  fields: Record<string, any>
  compressed: boolean

  constructor(init: MemoryQueryResponseInit = {}) {
    this.fields = init.fields ?? {}
    this.compressed = init.compressed ?? false
  }
}

export interface ToolCallRequestInit {
  tool_name?: string
  parameters?: Record<string, any>
  timeout_ms?: number
  required_fields?: string[]
}

export class ToolCallRequest {
  tool_name: string
  parameters: Record<string, any>
  timeout_ms: number
  required_fields: string[]

  constructor(init: ToolCallRequestInit = {}) {
    this.tool_name = init.tool_name ?? ''
    this.parameters = init.parameters ?? {}
    this.timeout_ms = init.timeout_ms ?? 1800000
    this.required_fields = init.required_fields ?? []

    if (!this.tool_name) {
      throw new Error('tool_name is required')
    }
  }

  toDict(): Record<string, any> {
    return {
      tool_name: this.tool_name,
      parameters: this.parameters,
      timeout_ms: this.timeout_ms,
      required_fields: this.required_fields,
    }
  }
}

export interface ToolCallResponseInit {
  status?: string
  error_code?: string
  data?: Record<string, any>
}

export class ToolCallResponse {
  status: string
  error_code: string
  data: Record<string, any>

  constructor(init: ToolCallResponseInit = {}) {
    this.status = init.status ?? 'success'
    this.error_code = init.error_code ?? ''
    this.data = init.data ?? {}
  }
}

export interface PerceptionInputInit {
  input_type?: string
  raw_content?: Uint8Array
  language?: string | null
  sensitivity_level?: number
}

export class PerceptionInput {
  input_type: string
  raw_content: Uint8Array
  language: string | null
  sensitivity_level: number

  constructor(init: PerceptionInputInit = {}) {
    this.input_type = init.input_type ?? 'text'
    this.raw_content = init.raw_content ?? new Uint8Array()
    this.language = init.language ?? null
    this.sensitivity_level = init.sensitivity_level ?? 0

    if (!['text', 'image', 'audio'].includes(this.input_type)) {
      throw new Error(`Invalid input_type: ${this.input_type}`)
    }
    if (!(0 <= this.sensitivity_level && this.sensitivity_level <= 5)) {
      throw new Error('sensitivity_level must be between 0 and 5')
    }
  }
}

export interface LLMRequestInit {
  prompt?: string
  context?: Record<string, any>
  temperature?: number
  max_tokens?: number
}

export class LLMRequest {
  prompt: string
  context: Record<string, any>
  temperature: number
  max_tokens: number

  constructor(init: LLMRequestInit = {}) {
    this.prompt = init.prompt ?? ''
    this.context = init.context ?? {}
    this.temperature = init.temperature ?? 0.7
    this.max_tokens = init.max_tokens ?? 512

    if (!this.prompt) {
      throw new Error('prompt is required')
    }
    if (!(0.0 <= this.temperature && this.temperature <= 2.0)) {
      throw new Error('temperature must be between 0.0 and 2.0')
    }
    if (this.max_tokens <= 0) {
      throw new Error('max_tokens must be positive')
    }
  }
}

export interface LLMResponseInit {
  content?: string
  model?: string
  tokens_used?: number
}

export class LLMResponse {
  content: string
  model: string
  tokens_used: number

  constructor(init: LLMResponseInit = {}) {
    this.content = init.content ?? ''
    this.model = init.model ?? ''
    this.tokens_used = init.tokens_used ?? 0
  }
}

// ============================================================
// ErrorCode（对应 Python class ErrorCode —— 纯常量类）
// ============================================================

export const ErrorCode = {
  TOOL_PARAMETER_INVALID: 'TOOL_001',
  TOOL_SERVICE_TIMEOUT: 'TOOL_002',
  TOOL_APPROVAL_REJECTED: 'TOOL_003',
  TOOL_APPROVAL_TIMEOUT: 'TOOL_004',
  MEMORY_CONTEXT_EXCEEDED: 'MEMORY_101',
  MEMORY_FIELD_MISSING: 'MEMORY_102',
  LLM_GENERATION_FAILED: 'LLM_001',
  LLM_STREAM_ERROR: 'LLM_002',
  PERCEPTION_INPUT_INVALID: 'PERCEPTION_001',
  PERCEPTION_SENSITIVITY_REJECTED: 'PERCEPTION_002',
  EVENT_BUS_ERROR: 'BUS_001',
  // P3-12.3.1 多 Agent 协作错误码
  CONSENSUS_NOT_ENOUGH_PARTICIPANTS: 'CONSENSUS_001',
  CONSENSUS_QUORUM_NOT_MET: 'CONSENSUS_002',
  CONSENSUS_STRATEGY_ERROR: 'CONSENSUS_003',
} as const
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
