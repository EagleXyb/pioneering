// 对应文档 §4.3 建议2：工具结果缓存
//
// LRU + TTL 实现：按 tool_name + hash(args) 缓存工具返回结果，
// 避免相同参数的 search_engine / http_request 重复调用。
//
// 设计要点：
//   - 全局单例（getToolResultCache），所有工具共享一个缓存实例
//   - LRU 淘汰：超过 max_entries 时淘汰最久未访问的条目
//   - TTL 过期：条目在 ttl_ms 后自动失效（惰性删除，读取时检查）
//   - 仅缓存成功结果（status === 'success'），错误结果不缓存
//   - 默认关闭（tools.result_cache.enabled=false），零开销
//   - 仅对显式配置的工具启用缓存（tools.result_cache.tools.{tool_name}），
//     避免误缓存副作用工具（如 file_ops_write）

import { getConfig } from '../../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[tool-result-cache] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[tool-result-cache] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[tool-result-cache] ${msg}`, ...args),
}

interface _CacheEntry {
  /** 缓存值（JSON 字符串） */
  value: string
  /** 写入时间戳（ms），用于 TTL 判断 */
  timestamp: number
  /** TTL（ms），0 表示永不过期 */
  ttlMs: number
  /** 最近访问序号（单调递增计数器），用于 LRU 淘汰 */
  lastAccess: number
}

/**
 * 工具结果 LRU+TTL 缓存。
 *
 * 全局单例，所有工具共享。线程安全（JS 单线程，无需锁）。
 */
export class ToolResultCache {
  private _entries: Map<string, _CacheEntry> = new Map()
  private _maxEntries: number = 100
  /**
   * 单调递增访问序号，用于 LRU 淘汰。
   *
   * 使用计数器而非 Date.now()，因为后者毫秒精度在快速连续操作下
   * 无法区分访问顺序，会导致 LRU 淘汰不准确。
   */
  private _accessSeq: number = 0

  /** 设置全局最大条目数（LRU 淘汰阈值）。 */
  setMaxEntries(max: number): void {
    if (max > 0) this._maxEntries = max
  }

  /**
   * 读取缓存。
   *
   * @param key 缓存键（由 tool_name + hash(args) 组成）
   * @returns 命中返回 JSON 字符串；未命中或已过期返回 null
   */
  get(key: string): string | null {
    const entry = this._entries.get(key)
    if (entry === undefined) {
      return null
    }
    // TTL 检查（惰性删除）
    if (entry.ttlMs > 0 && Date.now() - entry.timestamp > entry.ttlMs) {
      this._entries.delete(key)
      logger.debug('Cache entry expired: key=%s', key)
      return null
    }
    // 更新访问序号（LRU）：每次读取递增，保证最新访问的条目序号最大
    entry.lastAccess = ++this._accessSeq
    return entry.value
  }

  /**
   * 写入缓存。
   *
   * 超过 max_entries 时按 LRU 淘汰最久未访问的条目。
   *
   * @param key    缓存键
   * @param value  缓存值（JSON 字符串）
   * @param ttlMs  TTL（ms），0 表示永不过期
   */
  set(key: string, value: string, ttlMs: number): void {
    // LRU 淘汰：超过上限时删除最久未访问的条目
    while (this._entries.size >= this._maxEntries) {
      this._evictLRU()
    }
    this._entries.set(key, {
      value,
      timestamp: Date.now(),
      ttlMs,
      lastAccess: ++this._accessSeq,
    })
  }

  /** 清空所有缓存。 */
  clear(): void {
    this._entries.clear()
  }

  /** 当前条目数（含已过期但未惰性删除的）。 */
  get size(): number {
    return this._entries.size
  }

  /** 淘汰最久未访问的条目（LRU）。 */
  private _evictLRU(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [k, e] of this._entries) {
      if (e.lastAccess < oldestTime) {
        oldestTime = e.lastAccess
        oldestKey = k
      }
    }
    if (oldestKey !== null) {
      this._entries.delete(oldestKey)
      logger.debug('Cache evicted (LRU): key=%s', oldestKey)
    }
  }
}

// ===== 全局单例 =====

let _singleton: ToolResultCache | null = null

/**
 * 获取全局工具结果缓存单例。
 *
 * 首次调用时从配置读取 max_entries 初始化。
 */
export function getToolResultCache(): ToolResultCache {
  if (_singleton === null) {
    _singleton = new ToolResultCache()
    try {
      const maxEntries = Number(getConfig().get('tools.result_cache.max_entries', 100))
      _singleton.setMaxEntries(maxEntries > 0 ? maxEntries : 100)
    } catch {
      // 配置读取失败时用默认值
    }
  }
  return _singleton
}

/** 重置单例（仅供测试使用）。 */
export function _resetToolResultCacheForTest(): void {
  _singleton = null
}

/**
 * 判断工具是否启用缓存（对应文档 §4.3 建议2）。
 *
 * 启用条件（全部满足）：
 *   1. tools.result_cache.enabled === true
 *   2. tools.result_cache.tools.{tool_name} 配置存在
 *
 * 设计：仅对显式配置的工具启用，避免误缓存副作用工具。
 *
 * @param toolName 工具名
 * @returns 启用返回 true，附带 TTL；否则返回 false
 */
export function isToolCacheEnabled(toolName: string): { enabled: boolean; ttlMs: number } {
  try {
    const cfg = getConfig()
    const enabled = Boolean(cfg.get('tools.result_cache.enabled', false))
    if (!enabled) return { enabled: false, ttlMs: 0 }
    const tools = cfg.get('tools.result_cache.tools', {}) ?? {}
    const toolCfg = tools[toolName]
    if (!toolCfg || typeof toolCfg !== 'object') {
      return { enabled: false, ttlMs: 0 }
    }
    const defaultTtl = Number(cfg.get('tools.result_cache.default_ttl_ms', 60000))
    const ttlMs = typeof toolCfg['ttl_ms'] === 'number'
      ? Number(toolCfg['ttl_ms'])
      : defaultTtl
    return { enabled: true, ttlMs: ttlMs > 0 ? ttlMs : 0 }
  } catch {
    return { enabled: false, ttlMs: 0 }
  }
}

/**
 * 计算缓存键（tool_name + hash(args)）。
 *
 * 使用确定性 JSON 序列化（key 排序）+ 简单字符串哈希。
 * 不引入 crypto 依赖，避免性能开销；缓存键碰撞概率极低（同工具同参数场景）。
 *
 * @param toolName 工具名
 * @param args     工具参数
 * @returns 缓存键字符串
 */
export function computeCacheKey(toolName: string, args: Record<string, any>): string {
  // 确定性序列化：key 排序，避免对象 key 顺序不同导致缓存未命中
  const stableJson = _stableStringify(args)
  return `${toolName}::${stableJson}`
}

/** 稳定 JSON 序列化（key 排序）。 */
function _stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(_stableStringify).join(',')}]`
  }
  const keys = Object.keys(value).sort()
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${_stableStringify(value[k])}`)
  return `{${pairs.join(',')}}`
}
