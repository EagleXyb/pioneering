/**
 * Headless Agent 事件总线
 *
 * 完全解耦于 UI 框架的发布/订阅模式事件总线，用于 Agent 运行过程中
 * 各组件之间的通信。
 */

export type AgentRunEventType =
  | 'run:started'
  | 'run:finished'
  | 'run:error'
  | 'phase:perception'
  | 'phase:memory'
  | 'phase:thinking'
  | 'phase:tool_calling'
  | 'phase:generating'
  | 'phase:done'
  | 'thinking:delta'
  | 'thinking:completed'
  | 'tool_call:started'
  | 'tool_call:completed'
  | 'tool_result:received'
  | 'reasoning:iteration'
  | 'answer:delta'
  | 'answer:completed'
  | 'error:occurred'

export interface AgentRunEvent {
  type: AgentRunEventType
  timestamp: number
  runId: string
  data: Record<string, unknown>
}

type EventHandler = (event: AgentRunEvent) => void

class AgentEventBus {
  private listeners = new Map<AgentRunEventType, Set<EventHandler>>()
  private wildcardListeners = new Set<EventHandler>()
  private eventLog: AgentRunEvent[] = []
  private maxLogSize = 500

  on(type: AgentRunEventType, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(handler)
    return () => {
      this.listeners.get(type)?.delete(handler)
    }
  }

  onAny(handler: EventHandler): () => void {
    this.wildcardListeners.add(handler)
    return () => {
      this.wildcardListeners.delete(handler)
    }
  }

  emit(type: AgentRunEventType, data: Record<string, unknown> = {}): void {
    const event: AgentRunEvent = {
      type,
      timestamp: Date.now(),
      runId: (data.runId as string) || '',
      data,
    }

    this.eventLog.push(event)
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize)
    }

    const handlers = this.listeners.get(type)
    if (handlers) {
      for (const handler of handlers) {
        this.safeInvoke(handler, event)
      }
    }

    for (const handler of this.wildcardListeners) {
      this.safeInvoke(handler, event)
    }
  }

  getLog(filter?: {
    type?: AgentRunEventType
    runId?: string
    limit?: number
  }): AgentRunEvent[] {
    let logs = [...this.eventLog]
    if (filter?.type) {
      logs = logs.filter((e) => e.type === filter.type)
    }
    if (filter?.runId) {
      logs = logs.filter((e) => e.runId === filter.runId)
    }
    const limit = filter?.limit ?? 100
    return logs.slice(-limit)
  }

  clearLog(): void {
    this.eventLog = []
  }

  clear(): void {
    this.listeners.clear()
    this.wildcardListeners.clear()
    this.eventLog = []
  }

  private safeInvoke(handler: EventHandler, event: AgentRunEvent): void {
    try {
      handler(event)
    } catch (err) {
      console.error('[AgentEventBus] handler error:', event.type, err)
    }
  }
}

/** 全局单例事件总线 */
export const agentEventBus = new AgentEventBus()

/**
 * React Hook：在组件中订阅 Agent 事件，自动管理订阅生命周期
 */
import { useEffect } from 'react'

export function useAgentEvent(
  type: AgentRunEventType | AgentRunEventType[],
  handler: EventHandler,
  deps: unknown[] = [],
): void {
  useEffect(() => {
    const types = Array.isArray(type) ? type : [type]
    const unsubs = types.map((t) => agentEventBus.on(t, handler))
    return () => unsubs.forEach((fn) => fn())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export function useAgentEventAny(
  handler: EventHandler,
  deps: unknown[] = [],
): void {
  useEffect(() => {
    const unsub = agentEventBus.onAny(handler)
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
