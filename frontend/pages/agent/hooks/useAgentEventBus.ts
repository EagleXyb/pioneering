/**
 * Headless Agent 事件总线
 *
 * 完全解耦于 UI 框架的发布/订阅模式事件总线，用于 Agent 运行过程中
 * 各组件之间的通信。ActivityPanel、StatusBar、StepRenderer 等组件
 * 通过订阅感兴趣的事件类型来获取实时运行状态。
 */

export type AgentRunEventType =
  // Run 生命周期
  | 'run:started'
  | 'run:finished'
  | 'run:error'
  // 阶段切换
  | 'phase:perception'
  | 'phase:memory'
  | 'phase:thinking'
  | 'phase:tool_calling'
  | 'phase:generating'
  | 'phase:done'
  // 思考过程
  | 'thinking:delta'
  | 'thinking:completed'
  // 工具调用
  | 'tool_call:started'
  | 'tool_call:completed'
  | 'tool_result:received'
  // 推理迭代
  | 'reasoning:iteration'
  // 回答生成
  | 'answer:delta'
  | 'answer:completed'
  // 错误
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

  /**
   * 订阅特定事件类型
   * @returns 取消订阅函数
   */
  on(type: AgentRunEventType, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(handler)
    return () => {
      this.listeners.get(type)?.delete(handler)
    }
  }

  /**
   * 订阅所有事件类型（通配符）
   * @returns 取消订阅函数
   */
  onAny(handler: EventHandler): () => void {
    this.wildcardListeners.add(handler)
    return () => {
      this.wildcardListeners.delete(handler)
    }
  }

  /**
   * 发布事件
   */
  emit(type: AgentRunEventType, data: Record<string, unknown> = {}): void {
    const event: AgentRunEvent = {
      type,
      timestamp: Date.now(),
      runId: (data.runId as string) || '',
      data,
    }

    // 追加到事件日志
    this.eventLog.push(event)
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize)
    }

    // 通知特定类型订阅者
    const handlers = this.listeners.get(type)
    if (handlers) {
      for (const handler of handlers) {
        this.safeInvoke(handler, event)
      }
    }

    // 通知通配符订阅者
    for (const handler of this.wildcardListeners) {
      this.safeInvoke(handler, event)
    }
  }

  /**
   * 获取事件日志
   */
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

  /**
   * 清空事件日志
   */
  clearLog(): void {
    this.eventLog = []
  }

  /**
   * 移除所有订阅者
   */
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