// 对应文档 §4.3 建议2：工具结果缓存单元测试
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  _resetToolResultCacheForTest,
  computeCacheKey,
  getToolResultCache,
  isToolCacheEnabled,
  ToolResultCache,
} from '../../../src/graph/adapters/tool-result-cache.js'

describe('ToolResultCache', () => {
  let cache: ToolResultCache

  beforeEach(() => {
    _resetToolResultCacheForTest()
    cache = new ToolResultCache()
    cache.setMaxEntries(3)
  })

  afterEach(() => {
    _resetToolResultCacheForTest()
  })

  it('set/get 基本读写', () => {
    cache.set('k1', 'value1', 0)
    expect(cache.get('k1')).toBe('value1')
    expect(cache.size).toBe(1)
  })

  it('未命中返回 null', () => {
    expect(cache.get('not-exist')).toBeNull()
  })

  it('TTL 过期后返回 null', async () => {
    cache.set('k1', 'value1', 50) // 50ms TTL
    expect(cache.get('k1')).toBe('value1')
    await new Promise((r) => setTimeout(r, 60))
    expect(cache.get('k1')).toBeNull()
  })

  it('TTL=0 表示永不过期', async () => {
    cache.set('k1', 'value1', 0)
    await new Promise((r) => setTimeout(r, 10))
    expect(cache.get('k1')).toBe('value1')
  })

  it('LRU 淘汰最久未访问的条目', () => {
    cache.set('k1', 'v1', 0)
    cache.set('k2', 'v2', 0)
    cache.set('k3', 'v3', 0)
    expect(cache.size).toBe(3)
    // 访问 k1，使其变为最近访问
    cache.get('k1')
    // 插入 k4，应淘汰最久未访问的 k2
    cache.set('k4', 'v4', 0)
    expect(cache.size).toBe(3)
    expect(cache.get('k2')).toBeNull()
    expect(cache.get('k1')).toBe('v1')
    expect(cache.get('k3')).toBe('v3')
    expect(cache.get('k4')).toBe('v4')
  })

  it('clear 清空所有缓存', () => {
    cache.set('k1', 'v1', 0)
    cache.set('k2', 'v2', 0)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('k1')).toBeNull()
  })
})

describe('computeCacheKey', () => {
  it('同工具同参数生成相同键', () => {
    const k1 = computeCacheKey('search_engine', { query: 'weather', max: 5 })
    const k2 = computeCacheKey('search_engine', { query: 'weather', max: 5 })
    expect(k1).toBe(k2)
  })

  it('不同工具生成不同键', () => {
    const k1 = computeCacheKey('search_engine', { query: 'weather' })
    const k2 = computeCacheKey('http_request', { query: 'weather' })
    expect(k1).not.toBe(k2)
  })

  it('不同参数生成不同键', () => {
    const k1 = computeCacheKey('search_engine', { query: 'weather' })
    const k2 = computeCacheKey('search_engine', { query: 'news' })
    expect(k1).not.toBe(k2)
  })

  it('对象 key 顺序不同但内容相同时生成相同键（稳定序列化）', () => {
    const k1 = computeCacheKey('search_engine', { a: 1, b: 2 })
    const k2 = computeCacheKey('search_engine', { b: 2, a: 1 })
    expect(k1).toBe(k2)
  })
})

describe('isToolCacheEnabled', () => {
  afterEach(() => {
    _resetToolResultCacheForTest()
  })

  it('全局禁用时返回 false', () => {
    // 默认配置 tools.result_cache.enabled=false
    const r = isToolCacheEnabled('search_engine')
    expect(r.enabled).toBe(false)
  })
})

describe('getToolResultCache 单例', () => {
  afterEach(() => {
    _resetToolResultCacheForTest()
  })

  it('多次调用返回同一实例', () => {
    const c1 = getToolResultCache()
    const c2 = getToolResultCache()
    expect(c1).toBe(c2)
  })

  it('重置后返回新实例', () => {
    const c1 = getToolResultCache()
    _resetToolResultCacheForTest()
    const c2 = getToolResultCache()
    expect(c1).not.toBe(c2)
  })
})
