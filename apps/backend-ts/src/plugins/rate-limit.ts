/**
 * 分层限流（P4）
 *
 * 维度：用户（防单账号刷量）+ 模型（防单模型被挤爆）。
 * 算法：固定窗口计数（每分钟），实现简单、可解释；多实例下为"每实例限额"，
 *       全局配额需要 Redis（终态再收敛）。
 *
 * 约束：
 *   - 限流发生在调用上游之前，超限请求不产生任何模型费用；
 *   - 0 表示关闭该维度（便于本地开发）；
 *   - 仅覆盖 LLM 入口（chat / agent completions），不影响普通 CRUD。
 */
import { env } from '../config/env.js'
import { TooManyRequestsError } from './error-handler.js'

export interface LimiterOptions {
  /** 每分钟允许的请求数；<=0 表示不限制 */
  limit: number
  windowMs?: number
  now?: () => number
}

interface Bucket {
  windowStart: number
  count: number
}

/** 固定窗口计数器（可注入时钟，便于测试）。 */
export class FixedWindowLimiter {
  private readonly _limit: number
  private readonly _windowMs: number
  private readonly _now: () => number
  private readonly _buckets = new Map<string, Bucket>()

  constructor(opts: LimiterOptions) {
    this._limit = Math.max(0, opts.limit)
    this._windowMs = Math.max(1_000, opts.windowMs ?? 60_000)
    this._now = opts.now ?? (() => Date.now())
  }

  get limit(): number {
    return this._limit
  }

  /** 尝试消费一个配额：true=放行，false=超限。 */
  hit(key: string): boolean {
    if (this._limit <= 0) return true
    const now = this._now()
    const bucket = this._buckets.get(key)

    if (!bucket || now - bucket.windowStart >= this._windowMs) {
      this._buckets.set(key, { windowStart: now, count: 1 })
      this._prune(now)
      return true
    }

    if (bucket.count >= this._limit) return false
    bucket.count += 1
    return true
  }

  /** 剩余可用次数（用于 Retry-After 提示）。 */
  remaining(key: string): number {
    if (this._limit <= 0) return Number.POSITIVE_INFINITY
    const bucket = this._buckets.get(key)
    if (!bucket || this._now() - bucket.windowStart >= this._windowMs) return this._limit
    return Math.max(0, this._limit - bucket.count)
  }

  reset(): void {
    this._buckets.clear()
  }

  private _prune(now: number): void {
    // 仅在创建新窗口时顺带清理，避免每次请求全表扫描
    if (this._buckets.size < 5_000) return
    for (const [key, bucket] of this._buckets) {
      if (now - bucket.windowStart >= this._windowMs) this._buckets.delete(key)
    }
  }
}

const userLimiter = new FixedWindowLimiter({ limit: env.RATE_LIMIT_USER_RPM })
const modelLimiter = new FixedWindowLimiter({ limit: env.RATE_LIMIT_MODEL_RPM })

/**
 * 检查并消费配额；超限抛 429。
 *
 * @param userId 已认证用户
 * @param model  本次请求的模型标识（别名或真实 ID）
 */
export function enforceRateLimit(userId: string, model?: string | null): void {
  if (!userLimiter.hit(`user:${userId}`)) {
    throw new TooManyRequestsError(
      `请求过于频繁（用户级 ${env.RATE_LIMIT_USER_RPM} 次/分钟），请稍后重试`,
    )
  }
  const modelKey = (model ?? '').trim()
  if (modelKey && !modelLimiter.hit(`model:${modelKey}`)) {
    throw new TooManyRequestsError(
      `模型 ${modelKey} 当前请求过多（${env.RATE_LIMIT_MODEL_RPM} 次/分钟），请稍后重试`,
    )
  }
}

/** 测试辅助：清空计数，避免用例间串扰。 */
export function _resetRateLimitsForTest(): void {
  userLimiter.reset()
  modelLimiter.reset()
}
