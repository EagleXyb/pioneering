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
  // 安全审计域事件（对应文档 §2.5 建议9：集中化审计日志）
  // 拦截、审批、拒绝等安全事件统一发布到此域，持久化到独立审计日志
  SECURITY: 'security',
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
  // 安全审计动作（对应文档 §2.5 建议9）
  // AUDIT：通用审计记录（拦截、限流、敏感检测命中等）
  // ALLOW：放行记录（审批通过、安全校验通过）
  // DENY：拒绝记录（审批拒绝、安全校验拦截）
  AUDIT: 'audit',
  ALLOW: 'allow',
  DENY: 'deny',
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
//
// 协议演进（对应文档 §2.2 建议 1/2/4）：
//   - payload 泛型化：AgentEvent<T = unknown>，默认 unknown，
//     消除旧版 Uint8Array 强制 hex 编解码的冗余（JSON 场景直接传对象）
//     二进制场景（如 sensor 原始数据）通过 payloadAsBytes() 辅助方法读取
//   - metadata 放宽为 Record<string, unknown>：允许结构化值，
//     序列化时由 JSON.stringify 统一处理，类型安全
//   - 新增 schema_version：默认 1，协议演进时消费者按版本路由处理逻辑
//   - toDict/fromDict 兼容旧版 hex payload 字符串与新版结构化 payload

/** 当前协议版本号，协议演进时递增 */
export const AGENT_EVENT_SCHEMA_VERSION = 1 as const

export interface AgentEventInit<T = unknown> {
  event_id?: string
  trace_id?: string
  session_id?: string
  user_id?: string
  domain?: string
  action?: string
  timestamp?: Date
  /** 事件负载，可为结构化对象、字符串或 Uint8Array（二进制场景） */
  payload?: T | Uint8Array
  /** 事件元数据，允许结构化值（对应文档 §2.2 建议2） */
  metadata?: Record<string, unknown>
  priority?: EventPriority
  /** 协议版本号，缺失时默认 AGENT_EVENT_SCHEMA_VERSION */
  schema_version?: number
}

export class AgentEvent<T = unknown> {
  event_id: string
  trace_id: string
  session_id: string
  user_id: string
  domain: string
  action: string
  timestamp: Date
  payload: T | Uint8Array
  metadata: Record<string, unknown>
  priority: EventPriority
  schema_version: number

  constructor(init: AgentEventInit<T> = {}) {
    this.event_id = init.event_id ?? randomUUID()
    this.trace_id = init.trace_id ?? ''
    this.session_id = init.session_id ?? ''
    this.user_id = init.user_id ?? ''
    this.domain = init.domain ?? ''
    this.action = init.action ?? ''
    this.timestamp = init.timestamp ?? new Date()
    this.payload = (init.payload ?? null) as T | Uint8Array
    this.metadata = init.metadata ?? {}
    this.priority = init.priority ?? EventPriority.NORMAL
    this.schema_version = init.schema_version ?? AGENT_EVENT_SCHEMA_VERSION

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

  /**
   * 将 payload 作为 Uint8Array 读取（二进制场景辅助方法）。
   *
   * 兼容三种存储形式：
   *   - Uint8Array：原样返回
   *   - string：UTF-8 编码
   *   - 其他：JSON.stringify 后 UTF-8 编码
   */
  payloadAsBytes(): Uint8Array {
    const p = this.payload
    if (p instanceof Uint8Array) {
      return p
    }
    if (typeof p === 'string') {
      return new Uint8Array(Buffer.from(p, 'utf-8'))
    }
    if (p === null || p === undefined) {
      return new Uint8Array()
    }
    return new Uint8Array(Buffer.from(JSON.stringify(p), 'utf-8'))
  }

  /** 将 payload 作为字符串读取（JSON 场景辅助方法）。 */
  payloadAsString(): string {
    const p = this.payload
    if (typeof p === 'string') {
      return p
    }
    if (p instanceof Uint8Array) {
      return Buffer.from(p).toString('utf-8')
    }
    if (p === null || p === undefined) {
      return ''
    }
    return JSON.stringify(p)
  }

  toDict(): Record<string, any> {
    // payload 序列化策略（对应文档 §2.2 建议1）：
    //   - Uint8Array：保持 hex 编码（向后兼容旧消费者）
    //   - string：原样输出
    //   - 对象/其他：原样输出（JSON.stringify 友好）
    //   - null/undefined：输出空字符串
    let serializedPayload: any
    const p = this.payload
    if (p instanceof Uint8Array) {
      serializedPayload = p.length > 0 ? Buffer.from(p).toString('hex') : ''
    } else if (p === null || p === undefined) {
      serializedPayload = ''
    } else {
      serializedPayload = p
    }

    return {
      event_id: this.event_id,
      trace_id: this.trace_id,
      session_id: this.session_id,
      user_id: this.user_id,
      domain: this.domain,
      action: this.action,
      timestamp: this.timestamp.toISOString(),
      payload: serializedPayload,
      metadata: this.metadata,
      priority: this.priority,
      schema_version: this.schema_version,
    }
  }

  static fromDict<T = unknown>(data: Record<string, any>): AgentEvent<T> {
    let ts: Date
    const rawTs = data.timestamp
    if (typeof rawTs === 'string') {
      ts = new Date(rawTs)
    } else if (rawTs instanceof Date) {
      ts = rawTs
    } else {
      ts = new Date()
    }

    // payload 反序列化策略：
    //   - hex 字符串（旧版兼容）→ Uint8Array
    //   - 普通字符串 → 原样保留
    //   - 对象/数组 → 原样保留
    //   - 缺失 → null
    let payload: any
    if (data.payload === undefined || data.payload === null || data.payload === '') {
      payload = null
    } else if (typeof data.payload === 'string') {
      // 启发式判断：hex 字符串（仅含 0-9a-f 且偶数长度，长度 > 0）视为二进制
      if (/^[0-9a-fA-F]+$/.test(data.payload) && data.payload.length % 2 === 0) {
        payload = new Uint8Array(Buffer.from(data.payload, 'hex'))
      } else {
        payload = data.payload
      }
    } else {
      payload = data.payload
    }

    let priority: EventPriority = data.priority ?? EventPriority.NORMAL
    if (typeof priority === 'string') {
      priority = priority as EventPriority
    }

    return new AgentEvent<T>({
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
      schema_version: typeof data.schema_version === 'number' ? data.schema_version : AGENT_EVENT_SCHEMA_VERSION,
    })
  }
}

// ============================================================
// DTO 类（对应 Python @dataclass）
// ============================================================
//
// 协议演进（对应文档 §2.2 建议6）：
//   以下 DTO 类（LLMRequest/LLMResponse/MemoryQueryRequest/MemoryQueryResponse/
//   ToolCallRequest/ToolCallResponse/PerceptionInput）在当前代码库中均未被实例化
//   或用作类型注解，与 LangGraph State 字段及 ModuLLM 类型语义重叠。
//   全部标记 @deprecated，新代码应直接使用 ModuAgentState / ModuLLM 接口类型，
//   减少映射层。保留类定义用于向后兼容。

export interface MemoryQueryRequestInit {
  context_window?: string
  required_fields?: string[]
  enable_compression?: boolean
}

/** @deprecated 与 ModuAgentState.memory_query 字段语义重叠，新代码请直接使用 State 字段。 */
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

/** @deprecated 与 ModuAgentState.knowledge 字段语义重叠，新代码请直接使用 State 字段。 */
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

/** @deprecated 与 ModuAgentState.tool_calls 字段语义重叠，新代码请直接使用 State 字段。 */
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

/** @deprecated 与 ModuAgentState.tool_results 字段语义重叠，新代码请直接使用 State 字段。 */
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

/** @deprecated 与 config/schemas.ts 的 PerceptionInputSchema 语义重叠，新代码请使用 PerceptionInputSchema。 */
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

/** @deprecated 与 ModuLLM 接口的 LLMMessage[] / LLMInvokeOptions 语义重叠，新代码请使用 ModuLLM 接口类型。 */
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

/** @deprecated 与 ModuLLM 接口的 LLMResult 语义重叠，新代码请使用 LLMResult。 */
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
