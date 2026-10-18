// 供应商级熔断器（P1）
//
// 目的：上游持续 5xx / 超时时快速失败，避免每个请求都等满超时。
// 粒度：按 provider 维度；单 provider 阶段等价于全局开关。
import { LLMError } from '@pioneering/llm-contracts'

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
  failureThreshold?: number
  cooldownMs?: number
  now?: () => number
}

interface Entry {
  failures: number
  openedAt: number | null
  halfOpenInFlight: boolean
}

export class CircuitBreaker {
  private readonly _threshold: number
  private readonly _cooldownMs: number
  private readonly _now: () => number
  private readonly _entries = new Map<string, Entry>()

  constructor(opts: CircuitBreakerOptions = {}) {
    this._threshold = Math.max(1, opts.failureThreshold ?? 3)
    this._cooldownMs = Math.max(0, opts.cooldownMs ?? 30_000)
    this._now = opts.now ?? (() => Date.now())
  }

  private _entry(key: string): Entry {
    let entry = this._entries.get(key)
    if (!entry) {
      entry = { failures: 0, openedAt: null, halfOpenInFlight: false }
      this._entries.set(key, entry)
    }
    return entry
  }

  state(key: string): CircuitState {
    const entry = this._entry(key)
    if (entry.openedAt === null) return 'closed'
    if (this._now() - entry.openedAt >= this._cooldownMs) return 'half-open'
    return 'open'
  }

  /** 是否允许发起请求；进入 half-open 后只放行一个探针。 */
  canRequest(key: string): boolean {
    const state = this.state(key)
    if (state === 'closed') return true
    if (state === 'open') return false
    const entry = this._entry(key)
    if (entry.halfOpenInFlight) return false
    entry.halfOpenInFlight = true
    return true
  }

  onSuccess(key: string): void {
    const entry = this._entry(key)
    entry.failures = 0
    entry.openedAt = null
    entry.halfOpenInFlight = false
  }

  onFailure(key: string): void {
    const entry = this._entry(key)
    entry.failures += 1
    entry.halfOpenInFlight = false
    if (entry.failures >= this._threshold) {
      entry.openedAt = this._now()
    }
  }

  /** 供网关在熔断打开时抛出统一错误。 */
  assertAvailable(key: string): void {
    if (!this.canRequest(key)) {
      throw new LLMError('CIRCUIT_OPEN', `供应商 ${key} 处于熔断状态，请稍后重试`)
    }
  }
}
