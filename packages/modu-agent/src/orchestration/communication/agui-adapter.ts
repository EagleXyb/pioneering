// 对应 Python: orchestration/communication/agui_adapter.py
// AGUIStreamAdapter + AGUIStateMachine + 19 种 AG-UI 事件类型
import { randomUUID } from 'crypto'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[agui] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[agui] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[agui] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[agui] ${msg}`, ...args),
}

// ============================================================
// AGUIEventType（对应 Python str, Enum —— 20 种 AG-UI 事件类型）
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
} as const
export type AGUIEventType = (typeof AGUIEventType)[keyof typeof AGUIEventType]

// ============================================================
// P9.3.1: AGUIEvent payload 强类型映射（按事件类型区分 payload 结构）
// ============================================================

/** AG-UI 事件 → payload 数据结构映射表 */
export interface AGUIEventPayloadMap {
  RUN_STARTED: { threadId: string; runId: string }
  RUN_FINISHED: { threadId: string; runId: string }
  RUN_ERROR: { code: string; message: string }
  TEXT_MESSAGE_START: { messageId: string; role: string }
  TEXT_MESSAGE_CONTENT: { messageId: string; delta: string }
  TEXT_MESSAGE_END: { messageId: string }
  TEXT_MESSAGE_CHUNK: { messageId: string; delta: string }
  THINKING_START: { title: string }
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
    const payload = JSON.stringify({ type: eventType, ...data })
    // 防止 SSE 注入：转义 payload 中的换行符
    const escaped = payload.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    return `data: ${escaped}\n\n`
  }

  static toEventDict(eventType: AGUIEventType, data: Record<string, any>): Record<string, string> {
    const payload = JSON.stringify({ type: eventType, ...data })
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

export class AGUIStateMachine {
  trace_id: string
  message_id: string
  output_format: string

  thinking_started = false
  text_message_started = false
  has_error = false
  response_text = ''
  collected_text = ''

  pending_tool_calls: Record<string, Record<string, any>> = {}
  tool_call_records: ToolCallRecord[] = []

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
    if (!this.thinking_started) {
      events.push(this._emit(AGUIEventType.THINKING_START, { title: '深度思考' }))
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
    return events
  }

  emit_text_content(content: string): (AGUIEvent | string)[] {
    this.response_text += content
    const events: (AGUIEvent | string)[] = []
    if (!this.text_message_started) {
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_START, { messageId: this.message_id, role: 'assistant' }))
      this.text_message_started = true
    }
    events.push(this._emit(AGUIEventType.TEXT_MESSAGE_CONTENT, { messageId: this.message_id, delta: content }))
    return events
  }

  emit_text_end(): (AGUIEvent | string)[] {
    const events: (AGUIEvent | string)[] = []
    if (this.text_message_started) {
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_END, { messageId: this.message_id }))
    } else if (this.response_text) {
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_START, { messageId: this.message_id, role: 'assistant' }))
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_CONTENT, { messageId: this.message_id, delta: this.response_text }))
      events.push(this._emit(AGUIEventType.TEXT_MESSAGE_END, { messageId: this.message_id }))
    }
    return events
  }

  // ---- 工具调用事件 ----

  emit_tool_call_start(tool_id: string, tool_name: string, args_str: string = '{}'): (AGUIEvent | string)[] {
    const events: (AGUIEvent | string)[] = []
    this.pending_tool_calls[tool_id] = { tool_name, arguments: args_str }
    events.push(this._emit(AGUIEventType.TOOL_CALL_START, {
      toolCallId: tool_id,
      toolCallName: tool_name,
      parentMessageId: this.message_id,
    }))
    if (args_str && args_str !== '{}') {
      events.push(this._emit(AGUIEventType.TOOL_CALL_ARGS, { toolCallId: tool_id, delta: args_str }))
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
    let eventIdx = 0

    console.info('[agui-adapter] transform.start trace_id=%s message_id=%s', this._trace_id, this._message_id)
    yield sm.emit_run_started() as Record<string, string>

    for await (const event of langgraph_stream) {
      eventIdx++
      const event_type = (event.type as string) ?? ''
      console.info(
        '[agui-adapter] transform.event[%d] type=%s node=%s keys=%j',
        eventIdx, event_type, (event as any)?.node ?? '',
        Object.keys(event || {}),
      )
      let should_stop = false

      const processed = AGUIStreamAdapter._process_langgraph_event(sm, event, event_type)
      console.info(
        '[agui-adapter] transform.event[%d] processed_count=%d',
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
        const evData = (ev as any)?.data ?? ''
        const evType = evData ? (JSON.parse(evData).type ?? '') : ''
        console.info('[agui-adapter] transform.yield agui_type=%s', evType)
        yield ev as Record<string, string>
      }

      if (should_stop) {
        console.info('[agui-adapter] transform.stop_sentinel at event[%d]', eventIdx)
        break
      }

      if (event_type === 'values') {
        const data = event.data ?? {}
        if (typeof data === 'object' && data !== null) {
          const resp = data.response ?? ''
          if (resp && !final_response && !sm.text_message_started) {
            final_response = resp
          }
        }
      }
    }

    console.info(
      '[agui-adapter] transform.loop_end total_events=%d text_started=%s final_response_len=%d collected_len=%d',
      eventIdx, sm.text_message_started, final_response.length, sm.collected_text.length,
    )

    if (sm.has_error) {
      console.info('[agui-adapter] transform.has_error, returning early')
      this._sync_state_machine(sm)
      return
    }

    const thinking_end = sm.emit_thinking_end()
    if (thinking_end !== null) {
      yield thinking_end as Record<string, string>
    }

    if (!sm.text_message_started && final_response) {
      console.info('[agui-adapter] transform.fallback_text_content len=%d', final_response.length)
      for (const ev of sm.emit_text_content(final_response)) {
        yield ev as Record<string, string>
      }
    }

    for (const ev of sm.emit_text_end()) {
      yield ev as Record<string, string>
    }

    yield sm.emit_run_finished() as Record<string, string>
    console.info('[agui-adapter] transform.run_finished')

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
      let content = ''
      if (msg && typeof msg === 'object' && 'content' in msg) {
        content = msg.content ?? ''
      } else if (typeof msg === 'object' && msg !== null) {
        content = (msg as Record<string, any>).content ?? ''
      }
      if (content) {
        return sm.emit_text_content(content)
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
          if (tool_calls && Array.isArray(tool_calls) && tool_calls.length > 0) {
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
        const messages = data.messages ?? []
        for (const msg of messages) {
          if (msg?.type === 'tool') {
            const tool_call_id = msg.tool_call_id ?? ''
            const tool_name = msg.name ?? 'unknown'
            const content = msg.content ?? ''
            events.push(...sm.emit_tool_result(tool_call_id, tool_name, content, 'success'))
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
      return sm.emit_thinking('')
    }

    if (event_type === 'tool_call_start') {
      const tc_data = event.data ?? {}
      const tc_id = tc_data.tool_call_id ?? randomUUID()
      const tc_name = tc_data.tool_name ?? 'unknown'
      return sm.emit_tool_call_start(tc_id, tc_name, '{}')
    }

    if (event_type === 'tool_result') {
      const tc_data = event.data ?? {}
      const tc_id = tc_data.tool_call_id ?? ''
      const tc_name = tc_data.tool_name ?? 'unknown'
      const result_content = tc_data.result ?? '{}'
      return sm.emit_tool_result(tc_id, tc_name, result_content, 'success')
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
