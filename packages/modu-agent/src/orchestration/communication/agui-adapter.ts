// 对应 Python: orchestration/communication/agui_adapter.py
// AGUIStreamAdapter + AGUIStateMachine
// 事件类型共 24 种（见下方 AGUIEventType；数量由 AGUI_EVENT_TYPE_COUNT 派生，
// 不再手写常量，避免注释与实现漂移）
import { randomUUID } from 'crypto'
// T3-4：文档产物判定单一事实源（与 graph/nodes.ts 共用）
import { detectDocArtifact } from '../../tools/doc-writer-artifact.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[agui] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[agui] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[agui] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[agui] ${msg}`, ...args),
}

// ============================================================
// AGUIEventType（对应 Python str, Enum）
// T4-4：原注释写"19 种"/"20 种"，与实际 24 种不符，已改为派生常量。
// ============================================================

export const AGUIEventType = {
  RUN_STARTED: 'RUN_STARTED',
  RUN_FINISHED: 'RUN_FINISHED',
  RUN_ERROR: 'RUN_ERROR',
  TEXT_MESSAGE_START: 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT: 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END: 'TEXT_MESSAGE_END',
  TEXT_MESSAGE_CHUNK: 'TEXT_MESSAGE_CHUNK',
  THINKING_START: 'THINKING_START',
  THINKING_END: 'THINKING_END',
  THINKING_TEXT_MESSAGE_START: 'THINKING_TEXT_MESSAGE_START',
  THINKING_TEXT_MESSAGE_CONTENT: 'THINKING_TEXT_MESSAGE_CONTENT',
  THINKING_TEXT_MESSAGE_END: 'THINKING_TEXT_MESSAGE_END',
  TOOL_CALL_START: 'TOOL_CALL_START',
  TOOL_CALL_ARGS: 'TOOL_CALL_ARGS',
  TOOL_CALL_END: 'TOOL_CALL_END',
  TOOL_CALL_CHUNK: 'TOOL_CALL_CHUNK',
  TOOL_CALL_RESULT: 'TOOL_CALL_RESULT',
  STATE_SNAPSHOT: 'STATE_SNAPSHOT',
  STATE_DELTA: 'STATE_DELTA',
  MESSAGES_SNAPSHOT: 'MESSAGES_SNAPSHOT',
  ARTIFACT_CREATED: 'ARTIFACT_CREATED',
  // ===== HITL（Human-in-the-Loop）事件（阶段零 D3 收敛的最小集合）=====
  USER_QUESTION_REQUEST: 'USER_QUESTION_REQUEST',
  RUN_PAUSED: 'RUN_PAUSED',
  HITL_ABORTED: 'HITL_ABORTED',
} as const
export type AGUIEventType = (typeof AGUIEventType)[keyof typeof AGUIEventType]

/**
 * T4-4：事件类型总数（由 `AGUIEventType` 派生）。
 *
 * 此前文件头与常量区注释分别写着"19 种"与"20 种"，而对象实际已扩展到 24 种 ——
 * 手写数字必然漂移。改为从对象派生并导出，供测试与文档引用。
 */
export const AGUI_EVENT_TYPE_COUNT: number = Object.keys(AGUIEventType).length

// ============================================================
// P9.3.1: AGUIEvent payload 强类型映射（按事件类型区分 payload 结构）
// ============================================================

/**
 * HITL 用户提问事件 payload（阶段零 D3 收敛）。
 * tool_confirm=工具审批；clarifying/choice=需求澄清；
 * plan_confirm=方案/文档生成后的"是否基于产物继续执行"确认门——
 * 当前图中尚无节点发射该 kind（无 interrupt 生产方），仅做协议与透传预留，
 * 前端已具备对应内嵌卡 UI；未来由方案确认节点 interrupt({ kind:'plan_confirm', ... }) 启用。
 */
export interface UserQuestionRequestPayload {
  kind: 'tool_confirm' | 'clarifying' | 'choice' | 'plan_confirm'
  session_id: string
  run_id?: string
  message?: string
  /** kind='tool_confirm' 时携带待审批的工具调用列表 */
  tool_calls?: Array<{
    id: string;
    name: string;
    args: Record<string, any>
  }>
  /** kind='clarifying' 时携带澄清问题文本 */
  question?: string
  /** kind='choice' 时携带多选选项（description 为选项补充说明，可选） */
  options?: Array<{ id: string; label: string; description?: string }>
  /** kind='plan_confirm' 时携带待确认的产物文件列表（spec.md/tasks.md 等） */
  artifacts?: Array<{ name: string; path?: string }>
}

/** AG-UI 事件 → payload 数据结构映射表 */
export interface AGUIEventPayloadMap {
  RUN_STARTED: { threadId: string; runId: string }
  RUN_FINISHED: { threadId: string; runId: string }
  RUN_ERROR: { code: string; message: string }
  /** narration=true：该文本段是 ReAct 中间轮叙述（过程话术），不是最终回答 */
  TEXT_MESSAGE_START: { messageId: string; role: string; narration?: boolean }
  TEXT_MESSAGE_CONTENT: { messageId: string; delta: string }
  TEXT_MESSAGE_END: { messageId: string }
  TEXT_MESSAGE_CHUNK: { messageId: string; delta: string }
  THINKING_START: { title: string; round?: number }
  THINKING_END: Record<string, never>
  THINKING_TEXT_MESSAGE_START: { messageId: string; role?: string }
  THINKING_TEXT_MESSAGE_CONTENT: { delta: string }
  THINKING_TEXT_MESSAGE_END: { messageId: string }
  TOOL_CALL_START: { toolCallId: string; toolCallName: string; parentMessageId?: string }
  TOOL_CALL_ARGS: { toolCallId: string; delta: string }
  TOOL_CALL_END: { toolCallId: string }
  TOOL_CALL_CHUNK: { toolCallId: string; delta: string }
  TOOL_CALL_RESULT: {
    messageId?: string
    toolCallId: string
    toolCallName?: string
    content: string
    status?: string
  }
  STATE_SNAPSHOT: Record<string, unknown>
  STATE_DELTA: Record<string, unknown>
  MESSAGES_SNAPSHOT: { messages: unknown[] }
  ARTIFACT_CREATED: {
    artifactId: string
    name: string
    path: string
    absolutePath?: string
    size: number
    format: string
    type: string
    operation: string
    summary?: string
    title?: string
  }
  // ===== HITL 事件 payload =====
  USER_QUESTION_REQUEST: UserQuestionRequestPayload
  RUN_PAUSED: { threadId: string; runId: string }
  HITL_ABORTED: { threadId: string; runId: string; reason: string }
}

/** 按事件类型提取对应 payload 类型的辅助类型 */
export type AGUIEventPayload<T extends AGUIEventType> = AGUIEventPayloadMap[T]

/** 强类型 AGUI 事件（type + payload） */
export interface AGUITypedEvent<T extends AGUIEventType = AGUIEventType> {
  type: T
  data: AGUIEventPayloadMap[T]
}

// ============================================================
// AGUIEncoder（对应 Python AGUIEncoder）
// ============================================================

export class AGUIEncoder {
  static toSse(eventType: AGUIEventType, data: Record<string, any>): string {
    // type 放在展开之后，确保事件类型不被 payload 中的同名字段（如 artifact 的 type:'document'）覆盖
    const payload = JSON.stringify({ ...data, type: eventType })
    // 防止 SSE 注入：转义 payload 中的换行符
    const escaped = payload.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    return `data: ${escaped}\n\n`
  }

  static toEventDict(eventType: AGUIEventType, data: Record<string, any>): Record<string, string> {
    const payload = JSON.stringify({ ...data, type: eventType })
    const escaped = payload.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    return { data: escaped }
  }
}

// ============================================================
// 事件 dataclass（对应 Python @dataclass）
// ============================================================

export class RunStartedEvent {
  thread_id: string
  run_id: string
  constructor(thread_id = '', run_id = '') {
    this.thread_id = thread_id
    this.run_id = run_id
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.RUN_STARTED, { threadId: this.thread_id, runId: this.run_id })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.RUN_STARTED, { threadId: this.thread_id, runId: this.run_id })
  }
}

export class RunFinishedEvent {
  thread_id: string
  run_id: string
  constructor(thread_id = '', run_id = '') {
    this.thread_id = thread_id
    this.run_id = run_id
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.RUN_FINISHED, { threadId: this.thread_id, runId: this.run_id })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.RUN_FINISHED, { threadId: this.thread_id, runId: this.run_id })
  }
}

export class RunErrorEvent {
  code: string
  message: string
  constructor(code = '', message = '') {
    this.code = code
    this.message = message
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.RUN_ERROR, { code: this.code, message: this.message })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.RUN_ERROR, { code: this.code, message: this.message })
  }
}

export class TextMessageStartEvent {
  message_id: string
  role: string
  constructor(message_id = '', role = 'assistant') {
    this.message_id = message_id
    this.role = role
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.TEXT_MESSAGE_START, { messageId: this.message_id, role: this.role })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.TEXT_MESSAGE_START, { messageId: this.message_id, role: this.role })
  }
}

export class TextMessageContentEvent {
  message_id: string
  delta: string
  constructor(message_id = '', delta = '') {
    this.message_id = message_id
    this.delta = delta
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.TEXT_MESSAGE_CONTENT, { messageId: this.message_id, delta: this.delta })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.TEXT_MESSAGE_CONTENT, { messageId: this.message_id, delta: this.delta })
  }
}

export class TextMessageEndEvent {
  message_id: string
  constructor(message_id = '') {
    this.message_id = message_id
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.TEXT_MESSAGE_END, { messageId: this.message_id })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.TEXT_MESSAGE_END, { messageId: this.message_id })
  }
}

export class ThinkingStartEvent {
  title: string
  constructor(title = '深度思考') {
    this.title = title
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.THINKING_START, { title: this.title })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.THINKING_START, { title: this.title })
  }
}

export class ThinkingContentEvent {
  delta: string
  constructor(delta = '') {
    this.delta = delta
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT, { delta: this.delta })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT, { delta: this.delta })
  }
}

export class ThinkingEndEvent {
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.THINKING_END, {})
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.THINKING_END, {})
  }
}

export class ToolCallStartEvent {
  tool_call_id: string
  tool_call_name: string
  parent_message_id: string
  constructor(tool_call_id = '', tool_call_name = '', parent_message_id = '') {
    this.tool_call_id = tool_call_id
    this.tool_call_name = tool_call_name
    this.parent_message_id = parent_message_id
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.TOOL_CALL_START, {
      toolCallId: this.tool_call_id,
      toolCallName: this.tool_call_name,
      parentMessageId: this.parent_message_id,
    })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.TOOL_CALL_START, {
      toolCallId: this.tool_call_id,
      toolCallName: this.tool_call_name,
      parentMessageId: this.parent_message_id,
    })
  }
}

export class ToolCallArgsEvent {
  tool_call_id: string
  delta: string
  constructor(tool_call_id = '', delta = '') {
    this.tool_call_id = tool_call_id
    this.delta = delta
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.TOOL_CALL_ARGS, { toolCallId: this.tool_call_id, delta: this.delta })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.TOOL_CALL_ARGS, { toolCallId: this.tool_call_id, delta: this.delta })
  }
}

export class ToolCallEndEvent {
  tool_call_id: string
  constructor(tool_call_id = '') {
    this.tool_call_id = tool_call_id
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.TOOL_CALL_END, { toolCallId: this.tool_call_id })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.TOOL_CALL_END, { toolCallId: this.tool_call_id })
  }
}

export class ToolCallResultEvent {
  message_id: string
  tool_call_id: string
  tool_call_name: string
  content: string
  role: string
  status: string
  constructor(
    message_id = '',
    tool_call_id = '',
    tool_call_name = '',
    content = '',
    role = 'tool',
    status = '',
  ) {
    this.message_id = message_id
    this.tool_call_id = tool_call_id
    this.tool_call_name = tool_call_name
    this.content = content
    this.role = role
    this.status = status
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.TOOL_CALL_RESULT, {
      messageId: this.message_id,
      toolCallId: this.tool_call_id,
      toolCallName: this.tool_call_name,
      content: this.content,
      status: this.status,
      role: this.role,
    })
  }
  toEventDict(): Record<string, string> {
    return AGUIEncoder.toEventDict(AGUIEventType.TOOL_CALL_RESULT, {
      messageId: this.message_id,
      toolCallId: this.tool_call_id,
      toolCallName: this.tool_call_name,
      content: this.content,
      status: this.status,
      role: this.role,
    })
  }
}

export class ToolCallRecord {
  tool_name: string
  params: Record<string, any>
  result: Record<string, any>
  constructor(tool_name: string, params: Record<string, any> = {}, result: Record<string, any> = {}) {
    this.tool_name = tool_name
    this.params = params
    this.result = result
  }
}

// P2-12.2.5: 流处理哨兵——表示应停止迭代（错误或 done 事件）
export const _STREAM_STOP_SENTINEL = Symbol('stream_stop')

type AGUIEvent = Record<string, string>

// ============================================================
// AGUIStateMachine（对应 Python AGUIStateMachine）
// ============================================================

/**
 * 「最终回答」早期判定阈值（字符数）。
 *
 * 背景：同一消息内 content 先流、tool_calls 后流，因此只有消息结束才能确定
 * 该走 thinking（中间轮叙述，系统提示词要求"一句话"）还是 text（最终回答）。
 * 原实现严格等消息结束 → 最终回答被整段积压，长回答表现为"卡住后整段蹦出"。
 * 超过本阈值仍无 tool_calls 时按最终回答逐段直发（阈值覆盖一句话叙述的长度）。
 */
const _TEXT_STREAM_MIN_CHARS = 160

/**
 * P1 修复：这些图节点的 AI 消息仅供内部编排使用，禁止进入正文通道
 * （TEXT_MESSAGE_CONTENT）与落库。
 *
 * - planner：Plan-and-Execute 的计划生成节点。planner 使用 streaming LLM 产出
 *   计划（withStructuredOutput 失败时走 JSON-in-text 降级），其 token 会经
 *   messages 流到达 _process_langgraph_event；不过滤会被误判为"最终回答"
 *   逐段直发正文并写入 chat_messages.content——表现为聊天气泡出现大段计划 JSON。
 */
const _TEXT_SUPPRESSED_NODES: ReadonlySet<string> = new Set(['planner'])

export class AGUIStateMachine {
  trace_id: string
  message_id: string
  output_format: string

  thinking_started = false
  text_message_started = false
  /** 当前文本段是否为中间轮叙述（随 TEXT_MESSAGE_START 下发 narration 标记） */
  private _text_narration = false
  /** 本次 run 是否已下发过文本内容（叙述段/正文）；终态兜底去重用 */
  private _text_any_emitted = false
  has_error = false
  response_text = ''
  collected_text = ''
  /** 已开启的思考段轮次（多轮 ReAct 的顺序锚点，随 THINKING_START 递增并随事件下发） */
  thinking_round = 0

  pending_tool_calls: Record<string, Record<string, any>> = {}
  tool_call_records: ToolCallRecord[] = []

  // ---- ReAct 中间轮叙述缓冲 ----
  // 流式 chunk 的 content 与 tool_calls 是分离的（工具调用在 content 之后才流式发出），
  // 无法靠单个 chunk 判定该消息是否为"中间轮"。因此按消息 id 缓冲 content，
  // 待该消息轮次结束（id 切换或流终止）时，根据其是否带 tool_calls 决定走 thinking 还是 text。
  private _buf_msg_id = ''
  private _buf_content = ''
  private _buf_has_tool_calls = false
  /**
   * 缓冲内容已判定为「最终回答」并转入逐段直发（见 _maybe_early_stream_text）。
   * 为 true 时不再重复投递内容，flush 阶段只做状态收尾。
   */
  private _buf_streaming_text = false
  /**
   * 本轮是否已下发过工具调用（叙述标记兜底）。
   *
   * 缺陷背景：流式 chunk 的 tool_calls 与 content 常不在同一 chunk / 同一 id 上，
   * 权威 tool_calls 又多经 updates 到达，导致 _buf_has_tool_calls 漏判 ——
   * 「先说一句过渡话术、随后发起工具调用」会被 flush 成"最终回答"（正文只显示
   * 那一句过渡话术）。这里以「本轮是否真的下发过工具调用」补一道判据，
   * 复位点放在 tools 节点执行之后（下一轮才是干净的新轮次）。
   */
  private _round_tool_calls_emitted = false
  /** 本次 run 是否已下发过「最终回答」文本段（非 narration），终态兜底据此补发正文 */
  private _final_answer_emitted = false

  constructor(trace_id: string, message_id: string, output_format: string = 'dict') {
    this.trace_id = trace_id
    this.message_id = message_id
    this.output_format = output_format
  }

  private _emit<T extends AGUIEventType>(
    eventType: T,
    data: AGUIEventPayloadMap[T],
  ): AGUIEvent | string {
    if (this.output_format === 'sse') {
      return AGUIEncoder.toSse(eventType, data as Record<string, any>)
    }
    return AGUIEncoder.toEventDict(eventType, data as Record<string, any>)
  }

  // ---- 生命周期事件 ----

  emit_run_started(): AGUIEvent | string {
    return this._emit(AGUIEventType.RUN_STARTED, { threadId: this.trace_id, runId: this.trace_id })
  }

  emit_run_finished(): AGUIEvent | string {
    return this._emit(AGUIEventType.RUN_FINISHED, { threadId: this.trace_id, runId: this.trace_id })
  }

  emit_run_error(code: string, message: string): AGUIEvent | string {
    this.has_error = true
    return this._emit(AGUIEventType.RUN_ERROR, { code, message })
  }

  // ---- 思考事件 ----

  emit_thinking(content: string, chunk_size = 30): (AGUIEvent | string)[] {
    const events: (AGUIEvent | string)[] = []
    // 空内容不开段也不下发：EventBridge 的 started/ended 只是轮次状态标记，
    // 早期实现把它们也喂进本方法，导致每次 run 前后各多出一个"幽灵空思考段"。
    if (!content) {
      return events
    }
    if (!this.thinking_started) {
      this.thinking_round += 1
      events.push(
        this._emit(AGUIEventType.THINKING_START, {
          title: '深度思考',
          round: this.thinking_round,
        }),
      )
      this.thinking_started = true
    }
    if (content) {
      for (let i = 0; i < content.length; i += chunk_size) {
        events.push(this._emit(AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT, { delta: content.slice(i, i + chunk_size) }))
      }
    }
    return events
  }

  emit_thinking_end(): AGUIEvent | string | null {
    if (this.thinking_started) {
      this.thinking_started = false
      return this._emit(AGUIEventType.THINKING_END, {})
    }
    return null
  }

  // ---- 文本消息事件 ----

  emit_token(token: string): (AGUIEvent | string)[] {
    this.response_text += token
    this.collected_text = this.response_text
    const events: (AGUIEvent | string)[] = []
    if (!this.text_message_started) {
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_START, { messageId: this.message_id, role: 'assistant' }))
      this.text_message_started = true
    }
    events.push(this._emit(AGUIEventType.TEXT_MESSAGE_CONTENT, { messageId: this.message_id, delta: token }))
    this._text_any_emitted = true
    return events
  }

  emit_text_content(content: string): (AGUIEvent | string)[] {
    // 叙述段（过程话术）不进正文累积：collected_text 是落库正文/复制分享的来源，
    // 若混入叙述，用户的"回答正文"会变成一串过程话术（历史缺陷）。
    if (!this._text_narration) {
      this.response_text += content
      this.collected_text = this.response_text
      this._final_answer_emitted = true
    }
    const events: (AGUIEvent | string)[] = []
    if (!this.text_message_started) {
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_START, {
        messageId: this.message_id,
        role: 'assistant',
        // 叙述段显式打标：前端据此与最终回答区分（复制/分享只取最终回答），
        // 落库侧同步持久化该标记（历史回放口径一致）
        ...(this._text_narration ? { narration: true } : {}),
      }))
      this.text_message_started = true
    }
    events.push(this._emit(AGUIEventType.TEXT_MESSAGE_CONTENT, { messageId: this.message_id, delta: content }))
    this._text_any_emitted = true
    return events
  }

  /**
   * 收尾当前文本段（叙述段与最终回答各自成段的关键）。
   *
   * 收尾后重置 text_message_started，使下一段文本重新发 TEXT_MESSAGE_START
   * （否则叙述段与最终回答会粘成同一段）。
   *
   * 兜底分支仅在「文本累积但从未下发过」的异常路径生效（_text_any_emitted
   * 记录是否下发过内容），避免终态 closing 时把已流式下发的正文重复整段重发。
   */
  emit_text_end(): (AGUIEvent | string)[] {
    const events: (AGUIEvent | string)[] = []
    if (this.text_message_started) {
      this.text_message_started = false
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_END, { messageId: this.message_id }))
    } else if (this.response_text && !this._text_any_emitted) {
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_START, { messageId: this.message_id, role: 'assistant' }))
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_CONTENT, { messageId: this.message_id, delta: this.response_text }))
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_END, { messageId: this.message_id }))
      this._text_any_emitted = true
    }
    return events
  }

  /**
   * 处理流式 messages chunk（按消息 id 缓冲）。
   *
   * 流式 chunk 的 content 与 tool_calls 分离：同一消息的 content token 先流出，
   * tool_call_chunks 后流出。因此必须缓冲整段 content，待该消息轮次结束时
   * 才能确定它是"中间轮叙述"（带 tool_calls → 正文 + narration 标记）
   * 还是"最终回答"（正文）。
   *
   * 调用时机：每收到一个 messages chunk。
   * 返回：本轮需要立即发出的事件（通常为空；id 切换时冲刷上一段缓冲）。
   */
  process_message_chunk(msg: any, content: string): (AGUIEvent | string)[] {
    const msgId: string = msg?.id ?? msg?.kwargs?.id ?? ''
    const chunkToolCalls =
      !!(msg?.tool_calls?.length) || !!(msg?.tool_call_chunks?.length)

    // 消息 id 未变：继续累积到当前缓冲
    if (msgId && msgId === this._buf_msg_id) {
      this._buf_content += content
      if (chunkToolCalls) this._buf_has_tool_calls = true
      return this._maybe_early_stream_text()
    }

    // 消息 id 变化：先冲刷上一段缓冲，再开启新缓冲
    const events = this.flush_message_buffer()
    this._buf_msg_id = msgId
    this._buf_content = content
    this._buf_has_tool_calls = chunkToolCalls
    this._buf_streaming_text = false
    return [...events, ...this._maybe_early_stream_text()]
  }

  /**
   * 工具节点执行完毕 → 复位「本轮发起过工具调用」标记。
   *
   * 复位点选在这里而不是缓冲 id 切换处：同一轮的 tool_calls 可能晚于文本 chunk
   * 到达（工具调用走 updates / 独立 chunk），在 id 切换处复位会让叙述判据失效。
   * 工具执行完才是真正的新轮次边界。
   */
  note_tools_executed(): void {
    this._round_tool_calls_emitted = false
  }

  /** 本次 run 是否已下发过「最终回答」文本段（非 narration）；终态兜底据此补发正文 */
  get has_final_answer_text(): boolean {
    return this._final_answer_emitted
  }

  /**
   * 早期直发：缓冲长度明显超过「中间轮叙述」的量级（系统提示词要求中间轮只允许
   * 一句话）且仍未出现 tool_calls 时，判定为最终回答 —— 立即把已缓冲内容作为
   * text 下发，后续增量逐段直发，避免长回答被整段积压到流结束才一次性下发。
   *
   * 一旦进入直发模式，同一消息的后续 chunk 直接逐段下发（不再缓冲）。
   *
   * 权衡：若模型违反提示词、先写长叙述再发起工具调用，该段内容会作为正文显示
   * （已下发的事件无法回收）；阈值 160 字符覆盖常见的中/英文一句话叙述。
   */
  private _maybe_early_stream_text(): (AGUIEvent | string)[] {
    if (this._buf_streaming_text) {
      const events = this._buf_content ? this.emit_text_content(this._buf_content) : []
      this._buf_content = ''
      return events
    }
    if (this._buf_has_tool_calls || this._buf_content.length < _TEXT_STREAM_MIN_CHARS) {
      return []
    }

    const events: (AGUIEvent | string)[] = []
    if (this.thinking_started) {
      const te = this.emit_thinking_end()
      if (te !== null) events.push(te)
    }
    this._buf_streaming_text = true
    events.push(...this.emit_text_content(this._buf_content))
    this._buf_content = ''
    return events
  }

  /**
   * 冲刷消息缓冲：根据缓冲消息是否带 tool_calls，
   * 将其 content 路由到正文（中间轮叙述，带 narration 标记）或正文（最终回答）。
   *
   * 两类文本都走 text 通道，但语义与呈现不同：
   *   - 叙述段：独立成段 + narration 标记 → 渲染为正文、与工具动作行交错
   *     （WorkBuddy 风格），复制/分享与落库按标记把过程话术排除在「回答」之外；
   *   - 最终回答：独立成段 + 无标记 → 复制/分享的正文。
   * 思维链（reasoning delta）仍留在思考面板，思考块因此只含推理，层级更干净。
   *
   * @param authoritativeToolCalls 可选。来自 updates 事件的权威 tool_calls 判定，
   *   优先于流式 chunk 累积的 _buf_has_tool_calls（因为流式 chunk 的 tool_calls
   *   可能晚于 content 到达，updates 里完整 AIMessage 的 tool_calls 才是权威）。
   */
  flush_message_buffer(authoritativeToolCalls?: boolean): (AGUIEvent | string)[] {
    const events: (AGUIEvent | string)[] = []
    const content = this._buf_content
    // 判据顺序：权威 tool_calls → 流式 chunk 标记 → 本轮实际是否下发过工具调用。
    // 第三项是缺陷修复：本轮"先说一句过渡话术、随后发起工具调用"时，前两项都可能漏判
    // （tool_calls 走 updates / 不同 chunk），于是过渡话术被当成最终回答 —— 表现为
    // 触顶中止后"正文只有一句话"。
    const hasToolCalls =
      authoritativeToolCalls !== undefined
        ? authoritativeToolCalls
        : this._buf_has_tool_calls || this._round_tool_calls_emitted
    const alreadyStreamed = this._buf_streaming_text

    // 重置缓冲
    this._buf_msg_id = ''
    this._buf_content = ''
    this._buf_has_tool_calls = false
    this._buf_streaming_text = false

    if (alreadyStreamed) {
      // 内容已随流直发到 text 通道（判定为最终回答）；若权威判定事后表明该轮
      // 其实是中间轮（模型先写长叙述再调工具），已下发内容无法回收，
      // 这里只关闭可能仍开启的思考段，保持事件序列自洽。
      if (hasToolCalls && this.thinking_started) {
        const te = this.emit_thinking_end()
        if (te !== null) events.push(te)
      }
      return events
    }

    if (!content) {
      return events
    }

    if (hasToolCalls) {
      // 中间轮叙述 → 正文通道（WorkBuddy 风格）：与工具动作行交错显示，
      // 思维链留在思考面板；本段独立收尾，最终回答会另起一块。
      events.push(...this.emit_narration(content))
    } else {
      // 最终回答 → text 通道（若 thinking 仍开启，先关闭）
      if (this.thinking_started) {
        const te = this.emit_thinking_end()
        if (te !== null) events.push(te)
      }
      events.push(...this.emit_text_content(content))
    }
    return events
  }

  /**
   * 中间轮叙述（WorkBuddy 风格：正文通道）。
   *
   * 叙述是「模型对用户说的话」（我先做几组并行检索…），渲染在正文里与工具动作行
   * 交错；思维链（reasoning delta）仍留在思考面板 —— 两类文本受众不同，不再混在
   * 同一个折叠块里。
   *
   * 每轮叙述独立成段（START…CONTENT…END），因此下一段（下一轮叙述或最终回答）
   * 会另起一块，不会与最终回答粘连；段落带 narration 标记，前端复制/分享与落库
   * 据此把过程话术排除在「回答」之外。
   */
  emit_narration(content: string): (AGUIEvent | string)[] {
    const events: (AGUIEvent | string)[] = []
    if (this.thinking_started) {
      const te = this.emit_thinking_end()
      if (te !== null) events.push(te)
    }
    this._text_narration = true
    events.push(...this.emit_text_content(content))
    events.push(...this.emit_text_end())
    this._text_narration = false
    return events
  }

  // ---- 工具调用事件 ----

  /**
   * 工具调用开始（按 toolCallId **幂等**）。
   *
   * 同一次工具调用会被上游多条路径触发：
   *   - EventBridge 的 tool_call_start SSE 事件（更新流的侧路，只有 id/name，无参数）；
   *   - agent 节点的权威 updates（完整 AIMessage.tool_calls，带 args）。
   * 早期实现每次调用都发一遍 TOOL_CALL_START，前端因此渲染出「带目标 + 裸动作」两行，
   * 且裸行（无参数、无观测）永远等不到结果，表现为一条永远无法展开的动作行。
   *
   * 去重规则：同一 id 只开一行；后续调用仅在「此前无参数且未补发过」时补发一次
   * TOOL_CALL_ARGS（复用权威参数），避免重复参数把前端 args 串接坏。
   */
  emit_tool_call_start(tool_id: string, tool_name: string, args_str: string = '{}'): (AGUIEvent | string)[] {
    // 记下"本轮发起过工具调用"：叙述标记兜底据此把同轮文本判为过程叙述，
    // 而不是最终回答（见 _round_tool_calls_emitted 注释）
    this._round_tool_calls_emitted = true
    const events: (AGUIEvent | string)[] = []
    const args = args_str ?? ''
    const hasArgs = args.length > 0 && args !== '{}'

    const existing = this.pending_tool_calls[tool_id]
    if (existing) {
      const argsAlreadyEmitted = existing['args_emitted'] === true
      if (hasArgs && !argsAlreadyEmitted) {
        if (tool_name && !existing['tool_name']) existing['tool_name'] = tool_name
        existing['arguments'] = args
        existing['args_emitted'] = true
        events.push(this._emit(AGUIEventType.TOOL_CALL_ARGS, { toolCallId: tool_id, delta: args }))
      }
      return events
    }

    this.pending_tool_calls[tool_id] = {
      tool_name,
      arguments: args,
      args_emitted: hasArgs,
    }
    events.push(this._emit(AGUIEventType.TOOL_CALL_START, {
      toolCallId: tool_id,
      toolCallName: tool_name,
      parentMessageId: this.message_id,
    }))
    if (hasArgs) {
      events.push(this._emit(AGUIEventType.TOOL_CALL_ARGS, { toolCallId: tool_id, delta: args }))
    }
    return events
  }

  emit_tool_call_end(tool_id: string): AGUIEvent | string | null {
    if (tool_id in this.pending_tool_calls) {
      return this._emit(AGUIEventType.TOOL_CALL_END, { toolCallId: tool_id })
    }
    return null
  }

  emit_tool_result(
    tool_id: string,
    tool_name: string,
    result_str: string,
    status: string = 'unknown',
  ): (AGUIEvent | string)[] {
    const events: (AGUIEvent | string)[] = []
    if (tool_id in this.pending_tool_calls) {
      const effectiveName = tool_name || this.pending_tool_calls[tool_id].tool_name
      const argsStr = this.pending_tool_calls[tool_id].arguments || '{}'
      let params: Record<string, any> = {}
      try {
        params = JSON.parse(argsStr)
      } catch {
        params = {}
      }
      this.tool_call_records.push(new ToolCallRecord(effectiveName, params, { data: result_str, status }))
    }
    events.push(this._emit(AGUIEventType.TOOL_CALL_RESULT, {
      messageId: this.message_id,
      toolCallId: tool_id,
      toolCallName: tool_name,
      content: result_str,
      status,
    }))
    return events
  }

  // ---- 状态增量事件 ----

  emit_state_delta(kwargs: Record<string, any>): AGUIEvent | string {
    const data: Record<string, any> = { traceId: this.trace_id, ...kwargs }
    return this._emit(AGUIEventType.STATE_DELTA, data)
  }

  /** T4.2：联网搜索结构化来源（payload 与 chat 通道一致） */
  emit_web_search_sources(
    sources: Array<{ title: string; url: string; content: string; site: string }>,
  ): AGUIEvent | string {
    // WEB_SEARCH_SOURCES 为前端消费事件，不在 AGUIEventType 枚举内，直接构造事件 dict
    if (this.output_format === 'sse') {
      return AGUIEncoder.toSse('WEB_SEARCH_SOURCES' as AGUIEventType, { sources })
    }
    return AGUIEncoder.toEventDict('WEB_SEARCH_SOURCES' as AGUIEventType, { sources })
  }

  // ---- 产物事件 ----

  emit_artifact_created(artifact: {
    artifactId: string
    name: string
    path: string
    absolutePath?: string
    size: number
    format: string
    type: string
    operation: string
    summary?: string
    title?: string
  }): AGUIEvent | string {
    return this._emit(AGUIEventType.ARTIFACT_CREATED, artifact)
  }

  // ---- 批量结束事件 ----

  emit_tool_records_batch(): (AGUIEvent | string)[] {
    const events: (AGUIEvent | string)[] = []
    for (const record of this.tool_call_records) {
      const tool_call_id = randomUUID()
      events.push(this._emit(AGUIEventType.TOOL_CALL_START, {
        toolCallId: tool_call_id,
        toolCallName: record.tool_name,
        parentMessageId: this.message_id,
      }))
      const params_json = JSON.stringify(record.params)
      if (params_json && params_json !== '{}') {
        events.push(this._emit(AGUIEventType.TOOL_CALL_ARGS, { toolCallId: tool_call_id, delta: params_json }))
      }
      events.push(this._emit(AGUIEventType.TOOL_CALL_END, { toolCallId: tool_call_id }))
      const result_content = JSON.stringify(record.result)
      events.push(this._emit(AGUIEventType.TOOL_CALL_RESULT, {
        messageId: this.message_id,
        toolCallId: tool_call_id,
        toolCallName: record.tool_name,
        content: result_content,
      }))
    }
    return events
  }

  emit_extra_tool_records(raw_tool_results: any[]): (AGUIEvent | string)[] {
    const events: (AGUIEvent | string)[] = []
    const extra_records = AGUIStreamAdapter._parse_tool_records(raw_tool_results)
    const existing_names = new Set(this.tool_call_records.map((r) => r.tool_name))
    for (const rec of extra_records) {
      if (!existing_names.has(rec.tool_name)) {
        this.tool_call_records.push(rec)
        const tc_id = randomUUID()
        events.push(this._emit(AGUIEventType.TOOL_CALL_START, {
          toolCallId: tc_id,
          toolCallName: rec.tool_name,
          parentMessageId: this.message_id,
        }))
        events.push(this._emit(AGUIEventType.TOOL_CALL_END, { toolCallId: tc_id }))
        events.push(this._emit(AGUIEventType.TOOL_CALL_RESULT, {
          messageId: this.message_id,
          toolCallId: tc_id,
          toolCallName: rec.tool_name,
          content: JSON.stringify(rec.result),
        }))
      }
    }
    return events
  }

  emit_closing(): (AGUIEvent | string)[] {
    const events: (AGUIEvent | string)[] = []
    const thinking_end = this.emit_thinking_end()
    if (thinking_end !== null) {
      events.push(thinking_end)
    }
    events.push(...this.emit_text_end())
    events.push(this.emit_run_finished())
    return events
  }
}

// ============================================================
// AGUIStreamAdapter（对应 Python AGUIStreamAdapter）
// ============================================================

export class AGUIStreamAdapter {
  private _trace_id: string
  private _message_id: string
  private _tool_call_records: ToolCallRecord[] = []
  private _pending_tool_calls: Record<string, Record<string, any>> = {}
  private _collected_text: string = ''

  constructor(trace_id: string = '') {
    this._trace_id = trace_id
    this._message_id = ''
  }

  get trace_id(): string {
    return this._trace_id
  }

  get message_id(): string {
    return this._message_id
  }

  get tool_call_records(): ToolCallRecord[] {
    return this._tool_call_records
  }

  get collected_text(): string {
    return this._collected_text
  }

  async *transform(
    coordinator_stream: AsyncGenerator<Record<string, any>>,
  ): AsyncGenerator<string> {
    if (!this._trace_id) {
      this._trace_id = randomUUID()
    }
    this._message_id = randomUUID()

    yield new RunStartedEvent(this._trace_id, this._trace_id).toSse()

    const tool_records: ToolCallRecord[] = []
    let response_text = ''
    let has_error = false

    for await (const frame of coordinator_stream) {
      const event_type = (frame.event as string) ?? ''
      const data_str = (frame.data as string) ?? '{}'

      let data: Record<string, any>
      try {
        data = typeof data_str === 'string' ? JSON.parse(data_str) : data_str
      } catch {
        logger.warning('Failed to parse Coordinator frame data: %s', String(data_str).slice(0, 200))
        continue
      }

      if (event_type === 'status' || event_type === 'reasoning_iteration') {
        continue
      } else if (event_type === 'thinking') {
        response_text += data.content ?? ''
      } else if (event_type === 'tool_call_start') {
        const tc_data = { tool_name: data.name ?? '', arguments: data.arguments ?? '{}' }
        const pending_tc_id = data.id ?? randomUUID()
        this._pending_tool_calls[pending_tc_id] = tc_data
      } else if (event_type === 'tool_call_end') {
        // pass
      } else if (event_type === 'tool_result') {
        let rec_tool_name = data.name ?? ''
        const tc_id = data.id ?? ''
        if (tc_id in this._pending_tool_calls) {
          rec_tool_name = rec_tool_name || this._pending_tool_calls[tc_id].tool_name
        }
        const result_str = data.result ?? '{}'
        const result_status = data.status ?? 'unknown'
        let params: Record<string, any> = {}
        const argsStr = this._pending_tool_calls[tc_id]?.arguments ?? '{}'
        try {
          params = JSON.parse(argsStr)
        } catch {
          params = {}
        }
        tool_records.push(new ToolCallRecord(rec_tool_name, params, { data: result_str, status: result_status }))
      } else if (event_type === 'error') {
        has_error = true
        const error_code = data.error_code ?? ''
        const error_message = data.message ?? ''
        yield new RunErrorEvent(error_code, error_message).toSse()
        return
      } else if (event_type === 'token') {
        response_text += data.token ?? ''
      } else if (event_type === 'done') {
        const raw_tool_results = data.tool_results ?? []
        const extra_records = AGUIStreamAdapter._parse_tool_records(raw_tool_results)
        const existing_names = new Set(tool_records.map((r) => r.tool_name))
        for (const rec of extra_records) {
          if (!existing_names.has(rec.tool_name)) {
            tool_records.push(rec)
          }
        }
        break
      }
    }

    if (has_error) {
      return
    }

    for (const tool_record of tool_records) {
      const tool_call_id = randomUUID()
      this._tool_call_records.push(tool_record)

      yield new ToolCallStartEvent(tool_call_id, tool_record.tool_name, this._message_id).toSse()

      const params_json = JSON.stringify(tool_record.params)
      if (params_json && params_json !== '{}') {
        yield new ToolCallArgsEvent(tool_call_id, params_json).toSse()
      }

      yield new ToolCallEndEvent(tool_call_id).toSse()

      const result_content = JSON.stringify(tool_record.result)
      yield new ToolCallResultEvent(this._message_id, tool_call_id, tool_record.tool_name, result_content).toSse()
    }

    yield new TextMessageStartEvent(this._message_id).toSse()

    if (response_text) {
      yield new TextMessageContentEvent(this._message_id, response_text).toSse()
    }

    yield new TextMessageEndEvent(this._message_id).toSse()

    yield new RunFinishedEvent(this._trace_id, this._trace_id).toSse()
  }

  static _parse_tool_records(raw_tool_results: any[]): ToolCallRecord[] {
    const records: ToolCallRecord[] = []
    for (const item of raw_tool_results) {
      if (typeof item !== 'object' || item === null) {
        continue
      }
      let tool_name = item.tool ?? item.tool_name ?? ''
      let params = item.params ?? item.parameters ?? {}
      let result = item.result ?? item

      if (!tool_name && typeof result === 'object' && result !== null) {
        tool_name = result.tool ?? ''
      }

      if (tool_name) {
        records.push(new ToolCallRecord(
          tool_name,
          typeof params === 'object' && params !== null ? params : {},
          typeof result === 'object' && result !== null ? result : { data: String(result) },
        ))
      }
    }
    return records
  }

  async *transform_streaming(
    coordinator_stream: AsyncGenerator<Record<string, any>>,
  ): AsyncGenerator<string> {
    if (!this._trace_id) {
      this._trace_id = randomUUID()
    }
    this._message_id = randomUUID()

    const sm = new AGUIStateMachine(this._trace_id, this._message_id, 'sse')

    yield sm.emit_run_started() as string

    for await (const frame of coordinator_stream) {
      const event_type = (frame.event as string) ?? ''
      const data_str = (frame.data as string) ?? '{}'

      let data: Record<string, any>
      try {
        data = typeof data_str === 'string' ? JSON.parse(data_str) : data_str
      } catch {
        logger.warning('Failed to parse Coordinator frame data: %s', String(data_str).slice(0, 200))
        continue
      }

      let should_break = false
      for (const ev of AGUIStreamAdapter._process_coordinator_frame(sm, event_type, data)) {
        if (ev === _STREAM_STOP_SENTINEL) {
          should_break = true
          break
        }
        yield ev as string
      }
      if (should_break) {
        break
      }
    }

    if (sm.has_error) {
      this._sync_state_machine(sm)
      return
    }

    for (const ev of sm.emit_closing()) {
      yield ev as string
    }

    this._sync_state_machine(sm)
  }

  async *transform_streaming_events(
    coordinator_stream: AsyncGenerator<Record<string, any>>,
  ): AsyncGenerator<Record<string, string>> {
    if (!this._trace_id) {
      this._trace_id = randomUUID()
    }
    this._message_id = randomUUID()

    const sm = new AGUIStateMachine(this._trace_id, this._message_id, 'dict')

    yield sm.emit_run_started() as Record<string, string>

    for await (const frame of coordinator_stream) {
      const event_type = (frame.event as string) ?? ''
      const data_str = (frame.data as string) ?? '{}'

      let data: Record<string, any>
      try {
        data = typeof data_str === 'string' ? JSON.parse(data_str) : data_str
      } catch {
        logger.warning('Failed to parse Coordinator frame data: %s', String(data_str).slice(0, 200))
        continue
      }

      let should_break = false
      for (const ev of AGUIStreamAdapter._process_coordinator_frame(sm, event_type, data)) {
        if (ev === _STREAM_STOP_SENTINEL) {
          should_break = true
          break
        }
        yield ev as Record<string, string>
      }
      if (should_break) {
        break
      }
    }

    if (sm.has_error) {
      this._sync_state_machine(sm)
      return
    }

    for (const ev of sm.emit_closing()) {
      yield ev as Record<string, string>
    }

    this._sync_state_machine(sm)
  }

  private _sync_state_machine(sm: AGUIStateMachine): void {
    this._tool_call_records = sm.tool_call_records
    this._pending_tool_calls = sm.pending_tool_calls
    this._collected_text = sm.collected_text
  }

  static _process_coordinator_frame(
    sm: AGUIStateMachine,
    event_type: string,
    data: Record<string, any>,
  ): any[] {
    if (event_type === 'status') {
      const phase = data.phase ?? ''
      return [sm.emit_state_delta({ phase })]
    }

    if (event_type === 'reasoning_iteration') {
      return [sm.emit_state_delta({ iteration: data.index ?? 0, maxIterations: data.max ?? 3 })]
    }

    if (event_type === 'thinking') {
      const content = data.content ?? ''
      return sm.emit_thinking(content)
    }

    if (event_type === 'tool_call_start') {
      const tool_id = data.id ?? randomUUID()
      const tool_name = data.name ?? 'unknown'
      const args_str = data.arguments ?? '{}'
      return sm.emit_tool_call_start(tool_id, tool_name, args_str)
    }

    if (event_type === 'tool_call_end') {
      const tool_id = data.id ?? ''
      const end_ev = sm.emit_tool_call_end(tool_id)
      return end_ev !== null ? [end_ev] : []
    }

    if (event_type === 'tool_result') {
      const tool_id = data.id ?? ''
      const tool_name = data.name ?? ''
      const result_str = data.result ?? '{}'
      const result_status = data.status ?? 'unknown'
      return sm.emit_tool_result(tool_id, tool_name, result_str, result_status)
    }

    if (event_type === 'error') {
      const error_code = data.error_code ?? ''
      const error_message = data.message ?? ''
      return [sm.emit_run_error(error_code, error_message), _STREAM_STOP_SENTINEL]
    }

    if (event_type === 'token') {
      const token = data.token ?? ''
      return sm.emit_token(token)
    }

    if (event_type === 'done') {
      const raw_tool_results = data.tool_results ?? []
      const events: any[] = sm.emit_extra_tool_records(raw_tool_results)
      events.push(_STREAM_STOP_SENTINEL)
      return events
    }

    return []
  }

  // ============================================================
  // P1-1: LangGraph 输入源适配
  // ============================================================

  async *transform_langgraph_events(
    langgraph_stream: AsyncGenerator<Record<string, any>>,
  ): AsyncGenerator<Record<string, string>> {
    if (!this._trace_id) {
      this._trace_id = randomUUID()
    }
    this._message_id = randomUUID()

    const sm = new AGUIStateMachine(this._trace_id, this._message_id, 'dict')
    let final_response = ''
    /** responseNode（含触顶收尾节点）产出的权威正文：终态兜底补发时优先使用 */
    let state_response = ''
    let eventIdx = 0
    // HITL 中断探测（阶段零 D3）：LangGraph interrupt() 时 values 状态携带 __interrupt__，
    // 流会正常结束而非抛错——因此须在流结束后判定"本次 run 是否被 interrupt 暂停"。
    let interrupted = false
    let interruptValue: Record<string, any> | null = null

    // P1-24：流式热路径日志统一降为 debug（旧实现每个上游事件 3 条 console.info，
    // 长流产生数千行同步 IO）。
    logger.debug('transform.start trace_id=%s message_id=%s', this._trace_id, this._message_id)
    yield sm.emit_run_started() as Record<string, string>

    for await (const event of langgraph_stream) {
      eventIdx++
      const event_type = (event.type as string) ?? ''
      logger.debug(
        'transform.event[%d] type=%s node=%s keys=%j',
        eventIdx, event_type, (event as any)?.node ?? '',
        Object.keys(event || {}),
      )
      let should_stop = false

      const processed = AGUIStreamAdapter._process_langgraph_event(sm, event, event_type)
      logger.debug(
        'transform.event[%d] processed_count=%d',
        eventIdx, Array.isArray(processed) ? processed.length : 0,
      )
      for (const ev of processed) {
        if (ev === _STREAM_STOP_SENTINEL) {
          should_stop = true
          break
        }
        if (final_response === '' && sm.response_text) {
          final_response = sm.response_text
        }
        // P1-24：删除仅为日志服务的 JSON.parse（每个输出事件一次重复反序列化）。
        yield ev as Record<string, string>
      }

      if (should_stop) {
        logger.debug('transform.stop_sentinel at event[%d]', eventIdx)
        break
      }

      // HITL 中断探测（形状二）：LangGraph JS 在 updates 流模式下以 node='__interrupt__'
      // 产出中断事件，data 即 Interrupt[]（经 runner._normalizeLangGraphStream 拆包后
      // 的形状）。values 快照形状见下方 values 分支。
      if (event_type === 'updates' && (event as any)?.node === '__interrupt__') {
        const interrupts = Array.isArray(event.data) ? event.data : [event.data]
        if (interrupts.length > 0 && interrupts[0] !== null && interrupts[0] !== undefined) {
          interrupted = true
          const first = interrupts[0]
          interruptValue = (first?.value ?? first) as Record<string, any> | null
          }
      }

      if (event_type === 'values') {
        const data = event.data ?? {}
        if (typeof data === 'object' && data !== null) {
          // HITL 中断探测：LangGraph 中断时 values 状态携带 __interrupt__ 数组，
          // 其中每个元素为 Interrupt 对象（value 即 interrupt() 传入的载荷）。
          const interrupts = data['__interrupt__']
          if (Array.isArray(interrupts) && interrupts.length > 0) {
            interrupted = true
            const first = interrupts[0]
            interruptValue = (first?.value ?? first) as Record<string, any> | null
            logger.debug(
              'transform.interrupt_detected session=%s tool_calls=%d',
              this._trace_id, Array.isArray(interruptValue?.tool_calls) ? interruptValue!.tool_calls.length : 0,
            )
          }
          const resp = data.response ?? ''
          if (typeof resp === 'string' && resp) {
            state_response = resp
            if (!final_response && !sm.text_message_started) {
              final_response = resp
            }
          }
        }
      }
    }

    logger.debug(
      'transform.loop_end total_events=%d text_started=%s final_response_len=%d collected_len=%d',
      eventIdx, sm.text_message_started, final_response.length, sm.collected_text.length,
    )

    if (sm.has_error) {
      logger.debug('transform.has_error, returning early')
      this._sync_state_machine(sm)
      return
    }

    // ===== HITL 中断分支（阶段零 D3）=====
    // 本次 run 被 interrupt() 暂停：发出 USER_QUESTION_REQUEST（携带待审批项）→ RUN_PAUSED，
    // 并跳过全部"完成"语义（RUN_FINISHED / flush_message_buffer / emit_text_end），
    // 前端据此进入 paused 状态等待用户答复，而不是结束本轮。
    if (interrupted) {
      logger.debug('transform.interrupt_branch, emitting USER_QUESTION_REQUEST + RUN_PAUSED')
      const pauseEvents = AGUIStreamAdapter._process_interrupt_event(
        interruptValue,
        this._trace_id,
        this._message_id,
      )
      if (pauseEvents) {
        yield pauseEvents.userQuestionEvent
        yield pauseEvents.runPausedEvent
      }
      this._sync_state_machine(sm)
      return
    }

    // 冲刷残余的消息缓冲（最后一段 content 尚未发出），
    // 根据该消息是否带 tool_calls 决定走 thinking 还是 text。
    for (const ev of sm.flush_message_buffer()) {
      yield ev as Record<string, string>
    }

    const thinking_end = sm.emit_thinking_end()
    if (thinking_end !== null) {
      yield thinking_end as Record<string, string>
    }

    // 最终保护：工具已执行但流式全程无正文、且 state.response 兜底缺失时，
    // 基于 tool_call_records 合成摘要文本，确保前端一定收到 TEXT_MESSAGE 事件
    if (!sm.text_message_started && !final_response && sm.tool_call_records.length > 0) {
      const toolNames = Array.from(new Set(sm.tool_call_records.map((r) => r.tool_name)))
      final_response =
        `任务已完成：共执行 ${sm.tool_call_records.length} 次工具调用（${toolNames.join('、')}）。`
      logger.debug('transform.final_fallback len=%d', final_response.length)
    }

    // 兜底补发正文（缺陷修复）：本轮只下发了过程叙述（narration）而没有最终回答时，
    // 把权威正文补发出去 —— 否则用户看到的"正文"只是最后一段过渡话术，
    // 表现为"回答只有一句话"（典型场景：工具轮次触顶被中止）。
    // 优先用 state.response（包含触顶收尾节点产出的回答，或如实说明中止原因的文案）。
    if (!sm.has_final_answer_text) {
      const fallbackText = state_response || final_response
      if (fallbackText) {
        logger.debug('transform.fallback_answer_text len=%d', fallbackText.length)
        for (const ev of sm.emit_text_content(fallbackText)) {
          yield ev as Record<string, string>
        }
      }
    }

    // 步骤4 兜底：若 responseNode 提取的 final_response 比流式累积的 collected_text 更完整，
    // 用 final_response 覆盖 collected_text（仅影响持久化，不重发流式事件）。
    // 防御流式管道可能遗漏最终回答边缘 token 的情况。
    if (final_response && final_response.length > sm.collected_text.length) {
      logger.debug(
        'transform.override_collected_text stream_len=%d final_len=%d',
        sm.collected_text.length, final_response.length,
      )
      sm.collected_text = final_response
    }

    for (const ev of sm.emit_text_end()) {
      yield ev as Record<string, string>
    }

    yield sm.emit_run_finished() as Record<string, string>
    logger.debug('transform.run_finished')

    this._sync_state_machine(sm)
  }

  static _process_langgraph_event(
    sm: AGUIStateMachine,
    event: Record<string, any>,
    event_type: string,
  ): any[] {
    // --- LangGraph 原生事件 ---

    if (event_type === 'messages') {
      const msg = event.event ?? event.data ?? {}

      // P1 修复：内部编排节点（planner 等）的 AI 输出不得进入正文/落库，
      // 详见 _TEXT_SUPPRESSED_NODES 注释。metadata.langgraph_node 由 runner
      // 的 messages 归一化分支保留（runner.ts 的 [message_chunk, metadata] 元组）。
      const nodeName =
        typeof (event as any)?.metadata?.langgraph_node === 'string'
          ? String((event as any).metadata.langgraph_node)
          : ''
      if (nodeName && _TEXT_SUPPRESSED_NODES.has(nodeName)) {
        logger.debug('transform.messages.suppressed node=%s', nodeName)
        return []
      }

      // 只处理 AI 消息（AIMessageChunk）：messages 流中混有 ToolMessage（工具结果）
      // 与 HumanMessage 等非 AI 消息。ToolMessage 不带 tool_calls，若进入缓冲器，
      // 冲刷时会被误判为"最终回答"路由到 text 通道——工具结果 JSON 顶替正文，
      // 并提前置位 text_message_started，使末尾所有最终正文兜底逻辑失效。
      const msgType = typeof msg?._getType === 'function' ? msg._getType() : (msg?.type ?? '')
      const isToolMessage =
        msgType === 'tool' || !!(msg?.tool_call_id ?? msg?.kwargs?.tool_call_id)
      if (isToolMessage || (msgType && msgType !== 'ai')) {
        return []
      }

      // content 可能是 string 或结构化数组（如 [{type:'text',text:...}]），统一提取纯文本
      let content = ''
      const rawContent = msg?.content ?? ''
      if (typeof rawContent === 'string') {
        content = rawContent
      } else if (Array.isArray(rawContent)) {
        content = rawContent
          .filter((c: any) => c?.type === 'text')
          .map((c: any) => c?.text ?? '')
          .join('')
      }

      // 工具调用 chunk（无 content 但带 tool_call_chunks）也要喂给缓冲器，
      // 以便把当前消息标记为"中间轮"——这是分流的关键判定依据。
      const chunkToolCalls =
        !!(msg?.tool_calls?.length) || !!(msg?.tool_call_chunks?.length)
      if (content || chunkToolCalls) {
        return sm.process_message_chunk(msg, content)
      }
      return []
    }

    if (event_type === 'updates') {
      const node = event.node ?? ''
      const data = event.data ?? {}
      const events: any[] = []

      if (typeof data !== 'object' || data === null) {
        return []
      }

      if (node === 'agent') {
        const messages = data.messages ?? []
        if (messages && messages.length > 0) {
          const last_msg = messages[messages.length - 1]
          const tool_calls = last_msg?.tool_calls
          const authoritativeToolCalls =
            !!(tool_calls && Array.isArray(tool_calls) && tool_calls.length > 0)

          // agent 节点完成 = 一个 LLM 轮次结束（权威轮次边界）。
          // 用完整 AIMessage 的 tool_calls 做权威判定，冲刷该轮缓冲的 content：
          // 中间轮（带 tool_calls）→ thinking；最终轮（无 tool_calls）→ text。
          events.push(...sm.flush_message_buffer(authoritativeToolCalls))

          if (authoritativeToolCalls) {
            for (const tc of tool_calls) {
              const tc_id = tc.id ?? randomUUID()
              const tc_name = tc.name ?? 'unknown'
              const tc_args = JSON.stringify(tc.args ?? tc.parameters ?? {})
              events.push(...sm.emit_tool_call_start(tc_id, tc_name, tc_args))
              const end_ev = sm.emit_tool_call_end(tc_id)
              if (end_ev !== null) {
                events.push(end_ev)
              }
            }
          }
        }
      }

      if (node === 'tools') {
        // 工具执行完毕 = 轮次边界：复位"本轮发起过工具调用"标记（叙述判据用）
        sm.note_tools_executed()
        const messages = data.messages ?? []
        for (const msg of messages) {
          if (msg?.type === 'tool') {
            const tool_call_id = msg.tool_call_id ?? ''
            const raw_tool_name = msg.name ?? 'unknown'
            const content = msg.content ?? ''
            // === 解析 content JSON 作为工具名的权威来源（修复 _formatToolResult 之前的 tool 字段为空时漏识别）
            // 工具名识别优先级：content JSON.tool > msg.name > content 特征
            let parsed: any = null
            try {
              parsed = typeof content === 'string' ? JSON.parse(content) : content
            } catch {
              parsed = null
            }
            let tool_name = raw_tool_name
            if (parsed && typeof parsed === 'object' &&
                typeof parsed['tool'] === 'string' && parsed['tool'].length > 0) {
              tool_name = parsed['tool']
            } else if (!tool_name || tool_name === 'unknown') {
              // 容错：通过内容特征识别 doc_writer
              try {
                const cStr = typeof content === 'string' ? content : JSON.stringify(content)
                if ((cStr.includes('"format":"md"') || cStr.includes('"format": "md"')) &&
                     cStr.includes('.md')) {
                  tool_name = 'doc_writer'
                }
              } catch {
                // 识别失败维持原值
              }
            }

            events.push(...sm.emit_tool_result(tool_call_id, tool_name, content, 'success'))

            // T4.2：搜索工具结果收敛——产出 WEB_SEARCH_SOURCES（字段与 chat 通道一致），
            // 前端来源面板据此渲染；历史恢复走 contentBlocks.sources。
            const searchResults: unknown =
              parsed && typeof parsed === 'object'
                ? (parsed as Record<string, any>)?.data?.results
                : undefined
            if (Array.isArray(searchResults)) {
              const sources = (searchResults as Array<Record<string, unknown>>)
                .filter((r) => r && typeof r === 'object')
                .map((r) => ({
                  title: typeof r.title === 'string' ? r.title : '',
                  url: typeof r.url === 'string' ? r.url : '',
                  content: typeof r.snippet === 'string' ? r.snippet : '',
                  site: typeof r.source === 'string' ? r.source : '',
                }))
                .filter((s) => s.title || s.content)
              if (sources.length > 0) {
                events.push(sm.emit_web_search_sources(sources))
              }
            }

            // T3-4：ARTIFACT_CREATED 判定改用**单一事实源**
            // （`tools/doc-writer-artifact.ts`），与 graph/nodes.ts 写 state.artifacts
            // 共用同一实现，消除两份几乎逐字重复、却各有细微差异的判定逻辑。
            const detectedArtifact = detectDocArtifact(tool_name, content)

            if (detectedArtifact !== null) {
              const ad = detectedArtifact
              events.push(sm.emit_artifact_created({
                artifactId: tool_call_id || randomUUID(),
                name: ad.name,
                path: ad.path,
                absolutePath: ad.absolute_path,
                size: ad.size,
                format: ad.format,
                type: ad.type,
                operation: ad.operation,
                summary: ad.summary,
                title: ad.title,
              }))
            }
          }
        }
      }

      return events
    }

    if (event_type === 'values') {
      const data = event.data ?? {}
      if (typeof data === 'object' && data !== null) {
        const error_code = data.error_code ?? ''
        if (error_code) {
          return [sm.emit_run_error(error_code, data.error_message ?? ''), _STREAM_STOP_SENTINEL]
        }
      }
      return []
    }

    // --- SSE 细粒度事件（由 EventBridge 生成） ---

    if (event_type === 'thinking') {
      // status 语义见 event-bridge.ThinkingSSEPayload：
      //   delta   → 模型真实思维链增量（reasoning_content 旁路），开段并按需分包下发
      //   ended   → 关闭当前思考段（早期实现会把它当成新段开场，产生幽灵空段）
      //   started → 纯状态标记，待 delta 到达时再开段（避免空段）
      const thinking = (event.data ?? {}) as { status?: string; content?: string }
      if (thinking.status === 'delta') {
        return sm.emit_thinking(String(thinking.content ?? ''))
      }
      if (thinking.status === 'ended') {
        const end = sm.emit_thinking_end()
        return end === null ? [] : [end]
      }
      return []
    }

    if (event_type === 'tool_call_start') {
      // 动作行的唯一事实源是 agent 节点的权威 updates（带完整 args + TOOL_CALL_END）；
      // EventBridge 从同一个 updates 派生出的这条 SSE 侧路只是"同一事件的另一视图"，
      // 在此开行会产生两个后果：① 与权威路径重复开行；② 侧路先于原始事件下发，
      // 导致同一轮的「叙述段」排到动作行之后。故适配器侧不再开行（事件本身保留，
      // 其它宿主仍可消费）。
      void event
      return []
    }

    if (event_type === 'tool_result') {
      const tc_data = event.data ?? {}
      const tc_id = tc_data.tool_call_id ?? ''
      const raw_tc_name = tc_data.tool_name ?? 'unknown'
      const result_content = tc_data.result ?? '{}'

      // 同样解析 tool 名（多路径识别 doc_writer）
      let parsedResult: any = null
      try {
        parsedResult = typeof result_content === 'string' ? JSON.parse(result_content) : result_content
      } catch { parsedResult = null }
      let tc_name = raw_tc_name
      if (parsedResult && typeof parsedResult === 'object' &&
          typeof parsedResult['tool'] === 'string' && parsedResult['tool'].length > 0) {
        tc_name = parsedResult['tool']
      } else if (!tc_name || tc_name === 'unknown') {
        try {
          const cStr = typeof result_content === 'string' ? result_content : JSON.stringify(result_content)
          if ((cStr.includes('"format":"md"') || cStr.includes('"format": "md"')) && cStr.includes('.md')) {
            tc_name = 'doc_writer'
          }
        } catch {}
      }

      const events: any[] = [...sm.emit_tool_result(tc_id, tc_name, result_content, 'success')]

      // SSE 细粒度分支也要检测 doc_writer 产物
      const isDocWriterSuccess =
        tc_name === 'doc_writer' ||
        (parsedResult && typeof parsedResult === 'object' &&
         parsedResult['status'] === 'success' &&
         typeof (parsedResult['data'] ?? {})['format'] === 'string' &&
         (parsedResult['data'] ?? {})['format'] === 'md' &&
         typeof (parsedResult['data'] ?? {})['path'] === 'string' &&
         String((parsedResult['data'] ?? {})['path']).endsWith('.md'))

      // T3-4：同 messages 分支，收敛到单一事实源判定
      const detectedSseArtifact = detectDocArtifact(tc_name, result_content)
      if (detectedSseArtifact !== null) {
        const ad = detectedSseArtifact
        events.push(sm.emit_artifact_created({
          artifactId: tc_id || randomUUID(),
          name: ad.name,
          path: ad.path,
          absolutePath: ad.absolute_path,
          size: ad.size,
          format: ad.format,
          type: ad.type,
          operation: ad.operation,
          summary: ad.summary,
          title: ad.title,
        }))
      }

      return events
    }

    // --- P4 Plan-and-Execute 事件（由 LangGraphEventBridge 生成） ---
    // event-bridge.ts 将 planner / step_dispatch / step_finalize 节点的 plan_delta
    // 转成 plan_created / step_update 两种 SSE 事件类型。
    // 此处统一转成 AG-UI 标准的 STATE_DELTA 事件输出，payload 携带 { phase, plan?, step_update? }，
    // 与前端 Plan-and-Execute面板对接分析.md §2.2 约定一致。

    if (event_type === 'plan_created') {
      // planner 节点产出完整计划
      const planDelta = event.data ?? {}
      return [sm.emit_state_delta({
        phase: 'plan',
        plan: Array.isArray(planDelta.plan) ? planDelta.plan : [],
      })]
    }

    if (event_type === 'step_update') {
      // step_dispatch / step_finalize 产出步骤状态变更
      const planDelta = event.data ?? {}
      return [sm.emit_state_delta({
        phase: planDelta.phase ?? 'execute',
        step_update: planDelta.step_update ?? {},
      })]
    }

    return []
  }

  /**
   * HITL 中断事件处理（阶段零 D3；补强：clarify/choice 载荷激活）。
   *
   * 从 interrupt() 的载荷（interruptValue）构建最小事件对：
   *   USER_QUESTION_REQUEST（携带 kind 与对应字段）→ RUN_PAUSED。
   * 与主循环解耦：主循环在流结束后调用本函数，命中则跳过"完成"语义。
   *
   * kind 透传规则（与 runner.resolveInterruptKind 语义对齐）：
   *   - 载荷显式声明 'tool_confirm' | 'clarifying' | 'choice' → 原样透传；
   *   - 其余（历史/异常载荷）→ 保守兜底 'tool_confirm'，避免异常载荷触发澄清 UI。
   * clarifying/choice 透传 question/options；tool_confirm 透传 tool_calls。
   *
   * @param interruptValue interrupt() 传入的载荷（含 kind / question / options / tool_calls / session_id / message）
   * @param sessionId 会话标识（LangGraph thread_id）
   * @param runId 本次运行标识（AGUI message_id）
   * @returns 两个 AG-UI 事件 dict；无有效载荷时返回 null
   */
  static _process_interrupt_event(
    interruptValue: Record<string, any> | null,
    sessionId: string,
    runId: string,
  ): { userQuestionEvent: Record<string, string>; runPausedEvent: Record<string, string> } | null {
    const toolCalls = Array.isArray(interruptValue?.tool_calls)
      ? (interruptValue as Record<string, any>).tool_calls
      : []

    // kind 归一：载荷显式声明优先（白名单校验），否则保守兜底工具审批
    const rawKind = interruptValue?.kind
    const kind: UserQuestionRequestPayload['kind'] =
      rawKind === 'tool_confirm' ||
      rawKind === 'clarifying' ||
      rawKind === 'choice' ||
      rawKind === 'plan_confirm'
        ? rawKind
        : 'tool_confirm'

    // 澄清字段透传（类型校验后再下发；tool_confirm 载荷无这两项，天然为空）
    const rawQuestion = interruptValue?.question
    const question =
      typeof rawQuestion === 'string' && rawQuestion.trim() ? rawQuestion : undefined
    const rawOptions = interruptValue?.options
    const options = Array.isArray(rawOptions)
      ? (rawOptions as Array<{ id?: unknown; label?: unknown; description?: unknown }>)
          .filter((o) => o && typeof o.id === 'string' && typeof o.label === 'string')
          .map((o) => ({
            id: o.id as string,
            label: o.label as string,
            // 选项补充说明：校验为非空字符串后透传，其余情况省略
            ...(typeof o.description === 'string' && o.description.trim()
              ? { description: o.description }
              : {}),
          }))
      : undefined
    // plan_confirm 产物列表透传（name 必须为非空字符串；path 为可选非空字符串）
    const rawArtifacts = interruptValue?.artifacts
    const artifacts = Array.isArray(rawArtifacts)
      ? (rawArtifacts as Array<{ name?: unknown; path?: unknown }>)
          .filter((a) => a && typeof a.name === 'string' && a.name.trim())
          .map((a) => ({
            name: a.name as string,
            ...(typeof a.path === 'string' && a.path.trim() ? { path: a.path } : {}),
          }))
      : undefined

    const payload: UserQuestionRequestPayload = {
      kind,
      session_id: String(interruptValue?.session_id ?? sessionId),
      run_id: runId,
      message: String(
        interruptValue?.message ??
          (kind === 'tool_confirm'
            ? '工具调用需要人工审批后才能执行'
            : kind === 'plan_confirm'
              ? '方案文档已生成，请确认是否基于该方案继续执行。'
              : '需要你补充信息后才能继续。'),
      ),
      // 待审批工具调用仅在工具审批场景填充（澄清场景保持空数组，避免前端误渲染工具列表）
      tool_calls:
        kind === 'tool_confirm'
          ? toolCalls.map((tc: Record<string, any>) => ({
              id: String(tc['id'] ?? tc['tool_call_id'] ?? ''),
              name: String(tc['name'] ?? tc['tool_name'] ?? 'unknown'),
              args: (tc['args'] ?? tc['arguments'] ?? {}) as Record<string, any>,
            }))
          : [],
      ...(question ? { question } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(artifacts && artifacts.length > 0 ? { artifacts } : {}),
    }

    return {
      userQuestionEvent: AGUIEncoder.toEventDict(AGUIEventType.USER_QUESTION_REQUEST, payload),
      runPausedEvent: AGUIEncoder.toEventDict(AGUIEventType.RUN_PAUSED, {
        threadId: sessionId,
        runId,
      }),
    }
  }

  async *transform_langgraph(
    langgraph_stream: AsyncGenerator<Record<string, any>>,
  ): AsyncGenerator<string> {
    for await (const event_dict of this.transform_langgraph_events(langgraph_stream)) {
      const data = event_dict.data ?? ''
      yield `data: ${data}\n\n`
    }
  }
}

// ============================================================
// 辅助函数 + AGUIMessagesSnapshot
// ============================================================

export function encode_thinking_block(title: string, content: string): string {
  const frames: string[] = []
  if (title) {
    frames.push(AGUIEncoder.toSse(AGUIEventType.THINKING_START, { title }))
  }
  if (content) {
    const chunk_size = 30
    for (let i = 0; i < content.length; i += chunk_size) {
      frames.push(AGUIEncoder.toSse(AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT, { delta: content.slice(i, i + chunk_size) }))
    }
  }
  frames.push(AGUIEncoder.toSse(AGUIEventType.THINKING_END, {}))
  return frames.join('')
}

export class AGUIMessagesSnapshot {
  messages: Record<string, any>[]
  constructor(messages: Record<string, any>[] = []) {
    this.messages = messages
  }
  toSse(): string {
    return AGUIEncoder.toSse(AGUIEventType.MESSAGES_SNAPSHOT, { messages: this.messages })
  }
}
