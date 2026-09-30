// 对应 Python: components/memory/cache/short_term_memory.py
// InMemoryShortTermMemory：纯内存短期记忆实现
import { BaseMemory } from '../core/interfaces/memory.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[short-term-memory] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[short-term-memory] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[short-term-memory] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[short-term-memory] ${msg}`, ...args),
}

/**
 * 纯内存短期记忆实现。
 * 对应 Python InMemoryShortTermMemory。
 *
 * P2-3: 原 redis_adapter.py 名不副实（无 Redis），重命名为 short_term_memory.py
 * 以准确反映其实现。如需 Redis 支持，请新建 redis-short-term-memory.ts。
 *
 * P1-10:
 *   - 时间戳量纲统一为秒：写入时 >1e12 的入参视为毫秒自动 /1000（兼容 Date.now() 调用方）；
 *   - 过期清空后立即删除 userId 空键，避免 Map 随用户数线性泄漏；
 *   - 低频全量 sweep（默认 60s 节流），让"只写不读"用户的过期数据也能被回收。
 */
export class InMemoryShortTermMemory extends BaseMemory {
  /** 全量 sweep 默认节流间隔（秒）。 */
  static readonly DEFAULT_SWEEP_INTERVAL_SECONDS = 60
  /** 毫秒时间戳判定阈值（秒级时间戳约 1e9，毫秒约 1e12+）。 */
  private static readonly _MS_THRESHOLD = 1e12

  private _maxTurns: number
  private _ttlSeconds: number
  private _sweepIntervalSeconds: number
  private _store: Map<string, Array<Record<string, any>>> = new Map()
  private _lastSweepAt = 0

  constructor(
    maxTurns: number = 5,
    ttlSeconds: number = 3600,
    sweepIntervalSeconds: number = InMemoryShortTermMemory.DEFAULT_SWEEP_INTERVAL_SECONDS,
  ) {
    super()
    this._maxTurns = maxTurns
    this._ttlSeconds = ttlSeconds
    this._sweepIntervalSeconds = Math.max(0, sweepIntervalSeconds)
  }

  /** 归一化时间戳：毫秒（>1e12）转秒；秒级/0 原样返回。 */
  private _normalizeTimestamp(rawTs: number): number {
    return rawTs > InMemoryShortTermMemory._MS_THRESHOLD ? rawTs / 1000 : rawTs
  }

  query(
    userId: string,
    contextWindow: string,
    requiredFields: string[],
  ): Record<string, any> {
    const now = Date.now() / 1000
    this._maybeSweep(now)
    this._evictExpired(userId, now)

    const entries = this._store.get(userId)
    if (!entries || entries.length === 0) {
      return { history: [] }
    }

    const limit = InMemoryShortTermMemory._parseContextWindow(contextWindow)
    const recent = entries.slice(-limit)

    const filtered = recent.map((entry) => {
      const item: Record<string, any> = {}
      for (const field of requiredFields) {
        if (field in entry) {
          item[field] = entry[field]
        }
      }
      return item
    })

    return { history: filtered }
  }

  update(
    userId: string,
    newData: Record<string, any>,
    metadata: Record<string, any>,
  ): boolean {
    // P1-10：sweep 在写入前执行——先回收（含本用户的）过期条目，再压入新条目。
    // 放在 push 之后会出现"sweep 删除当前用户键 → 本函数后续访问悬空"的问题。
    this._maybeSweep()

    if (!this._store.has(userId)) {
      this._store.set(userId, [])
    }
    const entries = this._store.get(userId)!

    const entry: Record<string, any> = { ...newData }
    // P1-10：缺省/显式时间戳统一为秒（毫秒入参自动钳制，保证 TTL 始终生效）
    entry['_timestamp'] = this._normalizeTimestamp(
      typeof metadata.timestamp === 'number'
        ? metadata.timestamp
        : Date.now() / 1000,
    )
    entry['_session_id'] = metadata.session_id ?? ''

    entries.push(entry)

    if (entries.length > this._maxTurns * 2) {
      // 保留最后 maxTurns * 2 条
      const keep = entries.slice(-(this._maxTurns * 2))
      this._store.set(userId, keep)
    }

    logger.debug('Memory updated for user %s, total entries: %d', userId, entries.length)
    return true
  }

  private _evictExpired(userId: string, now: number = Date.now() / 1000): void {
    const entries = this._store.get(userId)
    if (!entries) {
      return
    }

    const cutoff = now - this._ttlSeconds
    const originalLen = entries.length
    const kept = entries.filter((e) => (e['_timestamp'] ?? 0) > cutoff)

    // P1-10：清空后删除空键，Map 不再随历史用户数无限增长
    if (kept.length === 0) {
      this._store.delete(userId)
    } else if (kept.length !== originalLen) {
      this._store.set(userId, kept)
    }

    if (kept.length < originalLen) {
      logger.debug(
        'Evicted %d expired entries for user %s',
        originalLen - kept.length,
        userId,
      )
    }
  }

  /**
   * P1-10：低频全量过期回收。
   * 单个用户的 query/update 只会驱逐自己；本 sweep 按时间节流遍历全部用户，
   * 回收"只写不读"用户的过期条目与空键。
   */
  private _maybeSweep(now: number = Date.now() / 1000): void {
    if (now - this._lastSweepAt < this._sweepIntervalSeconds) return
    this._lastSweepAt = now
    for (const userId of [...this._store.keys()]) {
      this._evictExpired(userId, now)
    }
  }

  private static _parseContextWindow(contextWindow: string): number {
    if (contextWindow.startsWith('last_') && contextWindow.endsWith('_turns')) {
      const numPart = contextWindow.slice(5, -6)
      const n = parseInt(numPart, 10)
      if (!isNaN(n)) {
        return n
      }
    }
    return 5
  }
}
