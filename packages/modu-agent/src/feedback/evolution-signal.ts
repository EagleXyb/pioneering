// 对应 Python: feedback/evolution_signal.py
// EvolutionSignal + EvolutionSignalCollector

import type { AgentEvent } from '../orchestration/communication/protocol.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[evolution-signal] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[evolution-signal] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[evolution-signal] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[evolution-signal] ${msg}`, ...args),
}

/**
 * 进化信号数据结构。
 *
 * 对应 Python dataclass EvolutionSignal。
 */
export class EvolutionSignal {
  constructor(
    public signalType: string,
    public source: string,
    public timestamp: number,
    public metrics: Record<string, number>,
    public context: Record<string, any>,
    public severity: string,  // "low" / "medium" / "high"
  ) {}
}

/**
 * 进化信号收集器：从 EventBus 订阅事件并生成进化信号。
 *
 * 对应 Python EvolutionSignalCollector。
 */
export class EvolutionSignalCollector {
  private _signals: EvolutionSignal[] = []
  private _counters: Map<string, number> = new Map()

  constructor(reportInterval: number = 100) {
    this._signals = []
    this._counters = new Map()
    // P2-1 修复：防止 report_interval=0 导致取模除零，下限钳制为 1
    if (reportInterval < 1) {
      logger.warning(
        'report_interval=%d 无效，已钳制为 1（必须为正整数）',
        reportInterval,
      )
    }
    this._reportInterval = Math.max(reportInterval, 1)
  }

  private _reportInterval: number

  /**
   * EventBus 订阅回调：收集推理事件。
   *
   * @param event AgentEvent 实例，null 时跳过
   */
  onAgentEvent(event: AgentEvent | null): void {
    if (event === null || event === undefined) {
      return
    }

    const counterKey = `${event.domain}:${event.action}`
    const count = (this._counters.get(counterKey) ?? 0) + 1
    this._counters.set(counterKey, count)

    if (count % this._reportInterval === 0) {
      const signal = this._createSignal(event, counterKey)
      this._signals.push(signal)
    }
  }

  /** 根据事件创建进化信号。 */
  private _createSignal(event: AgentEvent, counterKey: string): EvolutionSignal {
    const signalType = counterKey
    const source = `${event.domain}.${event.action}`

    const prioritySeverity: Record<string, string> = {
      low: 'low',
      normal: 'medium',
      high: 'high',
      critical: 'high',
    }
    const priority: string = (event as any).priority
    const severity = prioritySeverity[priority] ?? 'medium'

    const eventCount = this._counters.get(counterKey) ?? 0
    const metrics: Record<string, number> = {
      event_count: eventCount,
      priority_score: (priority === 'high' || priority === 'critical') ? 1.0 : 0.0,
    }

    const context: Record<string, any> = {
      domain: event.domain,
      action: event.action,
      event_id: event.event_id,
      trace_id: event.trace_id,
      session_id: event.session_id,
      metadata: event.metadata,
    }

    return new EvolutionSignal(
      signalType,
      source,
      Date.now() / 1000,  // 对应 Python time.time()（秒级时间戳）
      metrics,
      context,
      severity,
    )
  }

  /** 获取累积的进化信号。 */
  getSignals(): EvolutionSignal[] {
    return [...this._signals]
  }
}
