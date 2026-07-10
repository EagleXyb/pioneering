// 对应 Python: orchestration/communication/streaming.py
// SSEEncoder + StreamPublisher
import { AgentEvent, EventAction, EventDomain } from './protocol.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[streaming] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[streaming] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[streaming] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[streaming] ${msg}`, ...args),
}

export interface SSEFrame {
  event: string
  data: string
}

export class SSEEncoder {
  static encode_token(token: string, trace_id: string): SSEFrame {
    return {
      event: 'token',
      data: JSON.stringify({ token, trace_id }),
    }
  }

  static encode_error(error_code: string, message: string, trace_id: string): SSEFrame {
    return {
      event: 'error',
      data: JSON.stringify({ error_code, message, trace_id }),
    }
  }

  static encode_done(
    trace_id: string,
    tool_results?: Record<string, any>[] | null,
    usage?: Record<string, number> | null,
  ): SSEFrame {
    const data: Record<string, any> = { trace_id, tool_results: tool_results ?? [] }
    if (usage) {
      data.usage = usage
    }
    return {
      event: 'done',
      data: JSON.stringify(data),
    }
  }

  static encode_status(phase: string, trace_id: string): SSEFrame {
    return {
      event: 'status',
      data: JSON.stringify({ phase, trace_id }),
    }
  }

  static encode_thinking(content: string, trace_id: string): SSEFrame {
    return {
      event: 'thinking',
      data: JSON.stringify({ content, trace_id }),
    }
  }

  static encode_tool_call_start(
    tool_id: string,
    name: string,
    args: string,
    trace_id: string,
  ): SSEFrame {
    return {
      event: 'tool_call_start',
      data: JSON.stringify({ id: tool_id, name, arguments: args, trace_id }),
    }
  }

  static encode_tool_call_end(
    tool_id: string,
    name: string,
    args: string,
    trace_id: string,
  ): SSEFrame {
    return {
      event: 'tool_call_end',
      data: JSON.stringify({ id: tool_id, name, arguments: args, trace_id }),
    }
  }

  static encode_tool_result(
    tool_id: string,
    name: string,
    result: string,
    status: string,
    trace_id: string,
  ): SSEFrame {
    return {
      event: 'tool_result',
      data: JSON.stringify({ id: tool_id, name, result, status, trace_id }),
    }
  }

  static encode_reasoning_iteration(
    index: number,
    max_iterations: number,
    trace_id: string,
  ): SSEFrame {
    return {
      event: 'reasoning_iteration',
      data: JSON.stringify({ index, max: max_iterations, trace_id }),
    }
  }

  static to_sse_message(frame: SSEFrame): string {
    const event = frame.event || 'message'
    const data = frame.data ?? ''
    return `event: ${event}\ndata: ${data}\n\n`
  }
}

export class StreamPublisher {
  private _event_bus: any
  private _trace_id: string
  private _session_id: string
  private _user_id: string
  private _token_count = 0

  constructor(
    event_bus: any,
    trace_id: string,
    session_id: string,
    user_id: string,
  ) {
    this._event_bus = event_bus
    this._trace_id = trace_id
    this._session_id = session_id
    this._user_id = user_id
  }

  async publish_token(token: string): Promise<void> {
    this._token_count++
    if (this._token_count % 10 === 0) {
      const event = new AgentEvent({
        trace_id: this._trace_id,
        session_id: this._session_id,
        user_id: this._user_id,
        domain: EventDomain.REASONING,
        action: EventAction.STREAM,
        metadata: {
          phase: 'progress',
          token_count: String(this._token_count),
        },
      })
      await this._event_bus.publish(event)
    }
  }
}
