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
 */
export class InMemoryShortTermMemory extends BaseMemory {
  private _maxTurns: number
  private _ttlSeconds: number
  private _store: Map<string, Array<Record<string, any>>> = new Map()

  constructor(maxTurns: number = 5, ttlSeconds: number = 3600) {
    super()
    this._maxTurns = maxTurns
    this._ttlSeconds = ttlSeconds
  }

  query(
    userId: string,
    contextWindow: string,
    requiredFields: string[],
  ): Record<string, any> {
    this._evictExpired(userId)

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
    if (!this._store.has(userId)) {
      this._store.set(userId, [])
    }
    const entries = this._store.get(userId)!

    const entry: Record<string, any> = { ...newData }
    entry['_timestamp'] = metadata.timestamp ?? Date.now() / 1000
    entry['_session_id'] = metadata.session_id ?? ''

    entries.push(entry)

    if (entries.length > this._maxTurns * 2) {
      // 保留最后 maxTurns * 2 条
      const keep = entries.slice(-(this._maxTurns * 2))
      this._store.set(userId, keep)
    }

    logger.debug('Memory updated for user %s, total entries: %d', userId, this._store.get(userId)!.length)
    return true
  }

  private _evictExpired(userId: string): void {
    const entries = this._store.get(userId)
    if (!entries) {
      return
    }

    const now = Date.now() / 1000
    const cutoff = now - this._ttlSeconds
    const originalLen = entries.length
    const kept = entries.filter((e) => (e['_timestamp'] ?? 0) > cutoff)
    this._store.set(userId, kept)

    if (kept.length < originalLen) {
      logger.debug(
        'Evicted %d expired entries for user %s',
        originalLen - kept.length,
        userId,
      )
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
