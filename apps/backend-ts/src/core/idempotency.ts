// 幂等键（P2）
//
// 目标：弱网重发 / 客户端重试时，同一 Idempotency-Key 只执行一次、只计一次费。
//
// 适用范围：仅非流式补全（stream=false）。SSE 无法可靠重放，重复请求直接拒绝，
// 由客户端换用新 key 重试。
//
// 存储：进程内 LRU + TTL。单实例足够；多实例需要换成 Redis / DB（终态再收敛）。
import { randomUUID } from 'node:crypto'

export interface IdempotencyEntry {
  status: 'pending' | 'done'
  response?: unknown
  expiresAt: number
  createdAt: number
}

export interface IdempotencyStoreOptions {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

export class IdempotencyStore {
  private readonly _ttlMs: number
  private readonly _maxEntries: number
  private readonly _now: () => number
  private readonly _entries = new Map<string, IdempotencyEntry>()

  constructor(opts: IdempotencyStoreOptions = {}) {
    this._ttlMs = Math.max(1_000, opts.ttlMs ?? 10 * 60_000)
    this._maxEntries = Math.max(1, opts.maxEntries ?? 1_000)
    this._now = opts.now ?? (() => Date.now())
  }

  private _scopeKey(scope: string, key: string): string {
    return `${scope}:${key}`
  }

  private _prune(): void {
    const now = this._now()
    for (const [k, v] of this._entries) {
      if (v.expiresAt <= now) this._entries.delete(k)
    }
    // 超限时按插入顺序淘汰最旧项（Map 保序）
    while (this._entries.size > this._maxEntries) {
      const first = this._entries.keys().next()
      if (first.done) break
      this._entries.delete(first.value)
    }
  }

  /** 查询：命中 done 返回响应；pending 表示同 key 正在处理；null 表示无记录。 */
  lookup(scope: string, key: string): IdempotencyEntry | null {
    this._prune()
    const entry = this._entries.get(this._scopeKey(scope, key))
    if (!entry) return null
    if (entry.expiresAt <= this._now()) {
      this._entries.delete(this._scopeKey(scope, key))
      return null
    }
    return entry
  }

  /** 占位：返回 false 表示同 key 已存在（pending 或 done）。 */
  begin(scope: string, key: string): boolean {
    const existed = this.lookup(scope, key)
    if (existed) return false
    const now = this._now()
    this._entries.set(this._scopeKey(scope, key), {
      status: 'pending',
      expiresAt: now + this._ttlMs,
      createdAt: now,
    })
    this._prune()
    return true
  }

  /** 完成并缓存响应。 */
  complete(scope: string, key: string, response: unknown): void {
    const now = this._now()
    this._entries.set(this._scopeKey(scope, key), {
      status: 'done',
      response,
      expiresAt: now + this._ttlMs,
      createdAt: now,
    })
  }

  /** 失败：释放占位，允许同 key 重试。 */
  fail(scope: string, key: string): void {
    this._entries.delete(this._scopeKey(scope, key))
  }

  size(): number {
    this._prune()
    return this._entries.size
  }

  reset(): void {
    this._entries.clear()
  }
}

export const idempotencyStore = new IdempotencyStore()

/**
 * 提取并规范化幂等键。
 *
 * - 只接受字符串头；长度限制 8..200，避免超长 key 撑爆内存
 * - 未提供时返回 null（保持旧行为）
 */
export function getIdempotencyKey(headers: Record<string, unknown>): string | null {
  const raw = headers['idempotency-key'] ?? headers['Idempotency-Key']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (key.length < 8 || key.length > 200) return null
  return key
}

/** 生成一个幂等键（供内部调用或测试使用）。 */
export function newIdempotencyKey(): string {
  return randomUUID()
}
