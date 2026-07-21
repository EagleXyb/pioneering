// 对应 Python: modu_graph/adapters/event_bridge.py
// 事件桥接器：LangGraph stream → EventBus。
//
// 将 LangGraph astream / astream_events 产生的事件桥接到现有 EventBus，
// 保留现有 EventBus 订阅者（PersistentEventLog、EvolutionSignalCollector）
// 不受重构影响。
//
// 映射规则：
//   - messages stream → REASONING.GENERATE / STREAM
//   - updates stream（perception 节点）→ PERCEPTION.ANALYZE
//   - updates stream（memory_query 节点）→ MEMORY.QUERY
//   - updates stream（tools 节点）→ TOOL.INVOKE / TOOL.EXECUTE
//   - updates stream（agent 节点）→ REASONING.GENERATE
//
// SSE 细粒度事件：
//   - thinking：LLM 推理开始
//   - tool_call_start：工具调用开始
//   - tool_result：工具执行结果
import type { EventBus } from '../../orchestration/communication/message-bus.js'
import { get_event_bus } from '../../orchestration/communication/message-bus.js'
import {
  AgentEvent,
  EventAction,
  EventDomain,
  EventPriority,
} from '../../orchestration/communication/protocol.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.event_bridge] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.event_bridge] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.event_bridge] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.event_bridge] ${msg}`, ...args),
}

// LangGraph stream 事件 → AgentEvent 域/动作映射
const _NODE_DOMAIN_MAP: Record<string, string> = {
  perception: EventDomain.PERCEPTION,
  memory_query: EventDomain.MEMORY,
  agent: EventDomain.REASONING,
  tools: EventDomain.TOOL,
  // P4 Plan-and-Execute
  planner: EventDomain.PLAN,
  step_finalize: EventDomain.PLAN,
}

const _NODE_ACTION_MAP: Record<string, string> = {
  perception: EventAction.ANALYZE,
  memory_query: EventAction.QUERY,
  agent: EventAction.GENERATE,
  tools: EventAction.INVOKE,
  // P4 Plan-and-Execute
  planner: EventAction.PLAN_CREATED,
  step_finalize: EventAction.STEP_COMPLETED,
}

// SSE 事件类型
const _SSE_EVENT_TYPES = ['thinking', 'tool_call_start', 'tool_call_end', 'tool_result', 'response', 'plan_created', 'step_update']

/**
 * 将 LangGraph stream 事件桥接到现有 EventBus。
 *
 * 保留现有 EventBus 订阅者（PersistentEventLog、EvolutionSignalCollector）
 * 不受重构影响。作为 stream 消费者，同时透传原始事件供上游消费（如 SSE 输出）。
 *
 * 增强功能：
 *   - SSE 细粒度事件映射（thinking/tool_call_start/tool_result）
 *   - EvolutionSignalCollector 集成
 */
export class LangGraphEventBridge {
  private _eventBus: EventBus
  private _evolutionCollector: any
  private _traceId: string
  private _sessionId: string
  private _userId: string
  private _tokenCount: number
  private _inThinking: boolean
  private _toolCallStack: Array<Record<string, any>>

  constructor(
    eventBus?: EventBus | null,
    evolutionCollector?: any,
    traceId: string = '',
    sessionId: string = '',
    userId: string = '',
  ) {
    this._eventBus = eventBus || get_event_bus()
    this._evolutionCollector = evolutionCollector
    this._traceId = traceId
    this._sessionId = sessionId
    this._userId = userId
    this._tokenCount = 0
    this._inThinking = false
    this._toolCallStack = []
  }

  /**
   * 消费 LangGraph stream 事件，同步发布到 EventBus。
   *
   * 同时透传原始事件供上游消费（如 SSE 输出）。
   */
  async *consume(
    graphStream: AsyncGenerator<Record<string, any>>,
  ): AsyncGenerator<Record<string, any>> {
    for await (const event of graphStream) {
      // 映射并发布到 EventBus
      const agentEvent = this._mapToAgentEvent(event)
      if (agentEvent) {
        try {
          await this._eventBus.publish(agentEvent)
        } catch (e: any) {
          logger.error('EventBus publish error: %s', String(e))
        }
      }

      // 发送到 EvolutionSignalCollector
      if (this._evolutionCollector) {
        try {
          this._evolutionCollector.on_agent_event(agentEvent)
        } catch (e: any) {
          logger.error('EvolutionSignalCollector error: %s', String(e))
        }
      }

      // 发送 SSE 细粒度事件
      const sseEvents = this._emitSseEvents(event)
      for (const sseEvent of sseEvents) {
        yield sseEvent
      }

      // 透传原始事件
      yield event
    }
  }

  /**
   * 将 LangGraph stream 事件映射为 AgentEvent。
   *
   * 支持三种 LangGraph stream 格式：
   * 1. astream(stream_mode=["messages"]) → {"type": "messages", ...}
   * 2. astream(stream_mode=["updates"]) → {"type": "updates", "node": "...", ...}
   * 3. astream(stream_mode=["custom"]) → {"type": "custom", ...}
   */
  _mapToAgentEvent(event: Record<string, any>): AgentEvent | null {
    const eventType = event.type || ''

    // messages stream → token 级流式事件
    if (eventType === 'messages') {
      this._tokenCount++
      // 每 10 个 token 发布一次进度事件
      if (this._tokenCount % 10 === 0) {
        return new AgentEvent({
          trace_id: this._traceId,
          session_id: this._sessionId,
          user_id: this._userId,
          domain: EventDomain.REASONING,
          action: EventAction.STREAM,
          metadata: {
            phase: 'progress',
            token_count: String(this._tokenCount),
          },
        })
      }
      return null
    }

    // updates stream → 节点状态更新事件
    if (eventType === 'updates') {
      const node = event.node || ''
      const domain = _NODE_DOMAIN_MAP[node]
      const action = _NODE_ACTION_MAP[node]

      if (domain && action) {
        const data = event.data || {}
        let metadata: Record<string, string> = {}

        if (node === 'perception' && typeof data === 'object') {
          metadata = LangGraphEventBridge._extractPerceptionMetadata(data)
        } else if (node === 'memory_query' && typeof data === 'object') {
          metadata = {
            has_knowledge: String((data.knowledge || []).length > 0),
          }
        } else if (node === 'tools' && typeof data === 'object') {
          metadata = LangGraphEventBridge._extractToolMetadata(data)
        } else if (node === 'agent' && typeof data === 'object') {
          metadata = LangGraphEventBridge._extractAgentMetadata(data)
        } else if (node === 'planner' && typeof data === 'object') {
          const plan = data.plan || []
          metadata = {
            step_count: String(Array.isArray(plan) ? plan.length : 0),
            replan_count: String(data.replan_count ?? 0),
          }
        } else if (node === 'step_finalize' && typeof data === 'object') {
          metadata = {
            current_step_index: String(data.current_step_index ?? 0),
            plan_phase: String(data.plan_phase ?? ''),
          }
        }

        return new AgentEvent({
          trace_id: this._traceId,
          session_id: this._sessionId,
          user_id: this._userId,
          domain,
          action,
          metadata,
        })
      }
    }

    // custom stream → 自定义事件
    if (eventType === 'custom') {
      const customData = event.data || {}
      if (typeof customData === 'object') {
        const domainStr = customData.domain || ''
        const actionStr = customData.action || ''
        if (domainStr && actionStr) {
          return new AgentEvent({
            trace_id: this._traceId,
            session_id: this._sessionId,
            user_id: this._userId,
            domain: domainStr,
            action: actionStr,
            metadata: customData.metadata || {},
            priority: EventPriority.NORMAL,
          })
        }
      }
    }

    return null
  }

  /**
   * 发射 SSE 细粒度事件。
   *
   * 支持的事件类型：
   * - thinking：LLM 推理开始
   * - tool_call_start：工具调用开始
   * - tool_result：工具执行结果
   */
  _emitSseEvents(event: Record<string, any>): Array<Record<string, any>> {
    const sseEvents: Array<Record<string, any>> = []
    const eventType = event.type || ''

    // messages stream 开始 → thinking 事件
    if (eventType === 'messages') {
      const msgEvent = event.event
      if (msgEvent) {
        // 检查是否是 AI 消息开始
        const msgType = typeof msgEvent._getType === 'function' ? msgEvent._getType() : msgEvent.type
        if (msgType === 'ai') {
          if (!this._inThinking) {
            this._inThinking = true
            sseEvents.push({
              type: 'thinking',
              data: { status: 'started' },
            })
          }
        }
      }
    }

    // updates stream → 检查工具调用
    if (eventType === 'updates') {
      const node = event.node || ''
      const data = event.data || {}

      if (node === 'agent' && typeof data === 'object') {
        const messages = data.messages || []
        if (messages && messages.length > 0) {
          const lastMsg = messages[messages.length - 1]
          // 检查是否有 tool_calls
          const toolCalls = (lastMsg as any).tool_calls
          if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
            for (const tc of toolCalls) {
              const tcId = tc.id || ''
              const tcName = tc.name || ''
              // 检查是否已发射过 tool_call_start
              if (!this._toolCallStack.some((t) => t.id === tcId)) {
                sseEvents.push({
                  type: 'tool_call_start',
                  data: {
                    tool_call_id: tcId,
                    tool_name: tcName,
                  },
                })
                this._toolCallStack.push({ id: tcId, name: tcName })
              }
            }
          }
        }
      } else if (node === 'tools' && typeof data === 'object') {
        const messages = data.messages || []
        for (const msg of messages) {
          const msgType = typeof msg._getType === 'function' ? msg._getType() : msg.type
          if (msgType === 'tool') {
            const toolCallId = (msg as any).tool_call_id || ''
            const toolName = (msg as any).name || 'unknown'
            const content = (msg as any).content || ''

            // 查找对应的 tool_call_start
            const matching = this._toolCallStack.filter((t) => t.id === toolCallId)
            if (matching.length > 0) {
              this._toolCallStack = this._toolCallStack.filter((t) => t.id !== toolCallId)
            }

            sseEvents.push({
              type: 'tool_result',
              data: {
                tool_call_id: toolCallId,
                tool_name: toolName,
                result: content,
              },
            })
          }
        }
      }

      // P4 Plan-and-Execute：planner / step_finalize 节点的 SSE 细粒度事件。
      // payload 对齐前端 PlanStateDelta（phase + plan / step_update），
      // 供前端 planExecuteStore.applyPlanDelta 直接消费。
      if ((node === 'planner' || node === 'step_finalize' || node === 'step_dispatch') && typeof data === 'object') {
        const planDelta = data.plan_delta
        if (planDelta && typeof planDelta === 'object') {
          if (planDelta.phase === 'plan' && Array.isArray(planDelta.plan)) {
            sseEvents.push({
              type: 'plan_created',
              data: planDelta,
            })
          } else if (planDelta.phase === 'execute' && planDelta.step_update) {
            sseEvents.push({
              type: 'step_update',
              data: planDelta,
            })
          } else {
            // 兜底：未知 phase 时透传原始 delta，保持前后端协议弹性
            sseEvents.push({
              type: 'step_update',
              data: planDelta,
            })
          }
        }
      }
    }

    return sseEvents
  }

  /** 从感知节点更新数据中提取元数据。 */
  private static _extractPerceptionMetadata(data: Record<string, any>): Record<string, string> {
    const perception = data.perception_result
    if (!perception || typeof perception !== 'object') {
      return {
        sensitivity_level: String(data.sensitivity_level || 0),
        confidence: String(data.confidence || 1.0),
      }
    }

    const meta = perception.metadata || {}
    const parsedContent = perception.parsed_content || {}
    return {
      input_type: String(parsedContent.input_type || 'text'),
      detected_language: String(perception.detected_language || ''),
      confidence: String(perception.confidence || 1.0),
      sensitivity_level: String(meta.sensitivity_level || 0),
      injection_detected: String(meta.injection_detected || false),
      truncated: String(meta.truncated || false),
    }
  }

  /** 从工具节点更新数据中提取元数据。 */
  private static _extractToolMetadata(data: Record<string, any>): Record<string, string> {
    const messages = data.messages || []
    const metadata: Record<string, string> = { tool_count: String(messages.length) }

    for (const msg of messages) {
      if ((msg as any).name) {
        metadata.tool_name = (msg as any).name
      }
      if ((msg as any).content) {
        metadata.tool_status = 'success'
      }
    }

    return metadata
  }

  /** 从推理节点更新数据中提取元数据。 */
  private static _extractAgentMetadata(data: Record<string, any>): Record<string, string> {
    const messages = data.messages || []
    let hasToolCalls = false

    for (const msg of messages) {
      const toolCalls = (msg as any).tool_calls
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        hasToolCalls = true
        break
      }
    }

    return {
      has_tools: String(hasToolCalls),
      message_count: String(messages.length),
    }
  }
}
