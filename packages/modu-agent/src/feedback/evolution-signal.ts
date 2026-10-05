// 对应 Python: feedback/evolution_signal.py
// EvolutionSignal + EvolutionSignalCollector

import type { AgentEvent } from '../orchestration/communication/protocol.js'
// T1-1：静态引入全局 EventBus 单例。已核无循环依赖——message-bus.ts 仅依赖
// ./protocol.js，且 communication/ 下无任何模块反向引用 feedback/evolution。
import { get_event_bus } from '../orchestration/communication/message-bus.js'

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
 * P1-9：信号保留上限（环形缓冲语义，超出丢弃最旧）。
 * 命名与剔除手法对齐 loop-controller.ts 的 `_MAX_CUMULATIVE_SAMPLES`。
 */
const _MAX_SIGNALS = 500

/**
 * 进化信号收集器：从 EventBus 订阅事件并生成进化信号。
 *
 * 对应 Python EvolutionSignalCollector。
 */
export class EvolutionSignalCollector {
  private _signals: EvolutionSignal[] = []
  private _counters: Map<string, number> = new Map()
  /**
   * T1-1：EventBus 退订句柄。`attachEventBus()` 时建立，`detachEventBus()` 时释放。
   * 未 attach 时为 null（此时仅由 event-bridge 主动投递 onAgentEvent，行为同修复前）。
   */
  private _unsubscribe: (() => void) | null = null

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
   * T1-1：订阅 EventBus，使**非流式路径**发布的事件也能进入进化信号。
   *
   * 修复前 collector 仅由 `event-bridge.consume()` 主动投递（`onAgentEvent`），
   * 而 consensus 失败、guardrail 命中等信号是**直接 publish 到 EventBus** 的
   * （`orchestration/patterns/consensus.ts`、`perception/security/audit.ts`），
   * 从不经过 event-bridge → 事件"发而不收"，进化闭环实际断开。
   *
   * 幂等：重复 attach 会先 detach 旧订阅，避免重复计数。
   *
   * @param bus    目标 EventBus（默认全局单例）
   * @param domains 订阅的 domain 集合；缺省订阅全部（与 Python 实现一致）
   * @returns 退订函数（等价于 `detachEventBus`）
   */
  attachEventBus(
    bus?: { subscribe: (h: (e: AgentEvent) => void, d?: string | null) => () => void },
    domains?: string[] | null,
  ): () => void {
    this.detachEventBus()
    // 缺省订阅全局单例；显式传入 bus 时优先使用（便于测试注入）
    const resolved = bus ?? (get_event_bus() as any)
    if (!resolved || typeof resolved.subscribe !== 'function') {
      logger.warning('attachEventBus: 目标 EventBus 不可用，进化信号仅由 event-bridge 投递')
      return () => {}
    }
    const handler = (e: AgentEvent) => {
      try {
        this.onAgentEvent(e)
      } catch (err) {
        logger.error('onAgentEvent handler error: %s', String(err))
      }
    }
    // domain 缺省 = 全局订阅（EventBus 会与域级订阅者并集分发，不重复）
    this._unsubscribe = domains && domains.length > 0
      ? domains.map((d) => resolved.subscribe(handler, d)).at(-1)!
      : resolved.subscribe(handler, null)
    return () => this.detachEventBus()
  }

  /** T1-1：解除 EventBus 订阅（幂等）。 */
  detachEventBus(): void {
    if (this._unsubscribe) {
      try {
        this._unsubscribe()
      } catch (e) {
        logger.debug('detachEventBus failed: %s', String(e))
      }
      this._unsubscribe = null
    }
  }

  /** 是否已订阅 EventBus（可观测/测试用）。 */
  get attached(): boolean {
    return this._unsubscribe !== null
  }

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

    // T1-1 修复：原实现仅按 `count % reportInterval === 0` 采样，导致
    // **低频高危事件永远不会被记录**（如 consensus 失败只发生 1 次，count=1
    // 永远达不到 reportInterval=100 的阈值）——恰是进化闭环最该看到的信号被丢弃。
    // 现在 high/critical 事件即时成信号（不采样），常规事件仍按采样率削峰。
    const priority = (event as any).priority
    const isUrgent = priority === 'high' || priority === 'critical'
    if (isUrgent || count % this._reportInterval === 0) {
      const signal = this._createSignal(event, counterKey)
      this._signals.push(signal)
      // P1-9：环形上限，防止长跑进程内存随信号（含完整 metadata 快照）无界增长
      if (this._signals.length > _MAX_SIGNALS) {
        this._signals.splice(0, this._signals.length - _MAX_SIGNALS)
      }
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

  /**
   * 获取累积的进化信号（副本，防止外部修改内部缓冲）。
   *
   * @param sampleCount 传入时只取最近 N 条（slice(-N) 语义，与 loop-controller 一致）；
   *                    省略返回全部（受 _MAX_SIGNALS 上限约束，至多 500 条）。
   */
  getSignals(sampleCount?: number): EvolutionSignal[] {
    const all = [...this._signals]
    if (sampleCount !== undefined && Number.isFinite(sampleCount) && sampleCount >= 0) {
      const n = Math.floor(sampleCount)
      // 注意 slice(-0) 等价 slice(0)（返回全部），0 必须显式返回空数组
      return n === 0 ? [] : all.slice(-n)
    }
    return all
  }
}
