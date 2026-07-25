// 对应文档 §2.5 建议7：工具限流
//
// Token bucket 实现：按工具名配置 RPM（每分钟请求数）上限。
// 启用后 wrap_modu_tool 外层包装此 limiter，超限请求返回限流错误。
//
// 设计要点：
//   - 每个 toolName 独立 bucket，互不影响
//   - bucket 容量 = RPM（允许瞬时突发到 RPM）
//   - 补充速率 = RPM / 60（每秒补充）
//   - 默认关闭（tools.rate_limit.enabled=false），零开销
//   - 限流触发时发布 SECURITY.AUDIT 审计事件

import { getConfig } from '../../config/runtime-config.js'
import { publish_security_audit_event_sync } from '../../perception/security/audit.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[rate-limiter] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[rate-limiter] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[rate-limiter] ${msg}`, ...args),
}

interface _Bucket {
  /** 容量（最大令牌数 = RPM） */
  capacity: number
  /** 当前令牌数 */
  tokens: number
  /** 上次补充时间戳（ms） */
  lastRefill: number
  /** 补充速率（tokens/ms = RPM / 60000） */
  refillRate: number
}

export class ToolRateLimiter {
  private _buckets: Map<string, _Bucket> = new Map()
  private _enabled: boolean = false

  constructor() {
    this._refreshConfig()
  }

  /** 从 runtime-config 读取限流配置。 */
  private _refreshConfig(): void {
    try {
      this._enabled = Boolean(getConfig().get('tools.rate_limit.enabled', false))
    } catch {
      this._enabled = false
    }
  }

  /**
   * 获取或创建指定工具的 token bucket。
   *
   * 若 tools.rate_limit.limits 中未配置该工具名，返回 null（不限流）。
   */
  private _getOrCreateBucket(toolName: string): _Bucket | null {
    let rpm: number
    try {
      rpm = Number(getConfig().get(`tools.rate_limit.limits.${toolName}`, 0))
    } catch {
      rpm = 0
    }
    if (rpm <= 0) {
      return null  // 未配置，不限流
    }

    let bucket = this._buckets.get(toolName)
    if (!bucket) {
      bucket = {
        capacity: rpm,
        tokens: rpm,  // 初始满桶
        lastRefill: Date.now(),
        refillRate: rpm / 60000,  // RPM → tokens/ms
      }
      this._buckets.set(toolName, bucket)
    }
    return bucket
  }

  /**
   * 补充令牌（基于时间差）。
   */
  private _refill(bucket: _Bucket): void {
    const now = Date.now()
    const elapsed = now - bucket.lastRefill
    if (elapsed <= 0) return
    const refill = elapsed * bucket.refillRate
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + refill)
    bucket.lastRefill = now
  }

  /**
   * 尝试获取一个令牌。
   *
   * @param toolName 工具名
   * @returns true=允许调用，false=限流
   */
  tryAcquire(toolName: string): boolean {
    this._refreshConfig()
    if (!this._enabled) {
      return true  // 限流未启用
    }

    const bucket = this._getOrCreateBucket(toolName)
    if (bucket === null) {
      return true  // 该工具未配置限流
    }

    this._refill(bucket)

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }

    // 限流触发
    logger.warning(
      'Rate limit exceeded for tool %s: capacity=%d tokens=%.2f',
      toolName, bucket.capacity, bucket.tokens,
    )
    publish_security_audit_event_sync({
      eventType: 'tool_rate_limited',
      decision: 'deny',
      toolName,
      details: {
        capacity: bucket.capacity,
        remaining_tokens: bucket.tokens,
      },
    })
    return false
  }
}

/** 全局单例（避免每个 wrap_modu_tool 实例独立维护 bucket）。 */
let _globalLimiter: ToolRateLimiter | null = null

export function get_tool_rate_limiter(): ToolRateLimiter {
  if (_globalLimiter === null) {
    _globalLimiter = new ToolRateLimiter()
  }
  return _globalLimiter
}

/** 测试用：重置全局 limiter 单例。 */
export function _reset_tool_rate_limiter_for_test(): void {
  _globalLimiter = null
}
