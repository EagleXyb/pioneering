/**
 * P2 回归：幂等键
 *
 * 覆盖：占位互斥、完成缓存、失败释放、TTL 过期、容量淘汰、请求头解析。
 */
import { describe, it, expect } from 'vitest'
import {
  IdempotencyStore,
  getIdempotencyKey,
} from '../src/core/idempotency.ts'

describe('IdempotencyStore', () => {
  it('begin 后同 key 不可重复占位；complete 后可重放', () => {
    const store = new IdempotencyStore()
    expect(store.begin('u1', 'key-12345678')).toBe(true)
    expect(store.begin('u1', 'key-12345678')).toBe(false)

    const pending = store.lookup('u1', 'key-12345678')
    expect(pending?.status).toBe('pending')

    store.complete('u1', 'key-12345678', { ok: true })
    const done = store.lookup('u1', 'key-12345678')
    expect(done?.status).toBe('done')
    expect(done?.response).toEqual({ ok: true })
  })

  it('不同用户使用相同 key 互不影响', () => {
    const store = new IdempotencyStore()
    expect(store.begin('u1', 'same-key-123')).toBe(true)
    expect(store.begin('u2', 'same-key-123')).toBe(true)
  })

  it('fail 释放占位，允许重试', () => {
    const store = new IdempotencyStore()
    store.begin('u1', 'key-retry-1')
    store.fail('u1', 'key-retry-1')
    expect(store.lookup('u1', 'key-retry-1')).toBeNull()
    expect(store.begin('u1', 'key-retry-1')).toBe(true)
  })

  it('TTL 过期后视为无记录', () => {
    let now = 1_000
    const store = new IdempotencyStore({ ttlMs: 1_000, now: () => now })
    store.begin('u1', 'key-ttl-1')
    now += 1_500
    expect(store.lookup('u1', 'key-ttl-1')).toBeNull()
  })

  it('超过容量时淘汰最旧记录', () => {
    const store = new IdempotencyStore({ maxEntries: 2 })
    store.complete('u1', 'key-a', { n: 1 })
    store.complete('u1', 'key-b', { n: 2 })
    store.complete('u1', 'key-c', { n: 3 })
    expect(store.size()).toBe(2)
    expect(store.lookup('u1', 'key-a')).toBeNull()
    expect(store.lookup('u1', 'key-c')?.status).toBe('done')
  })
})

describe('getIdempotencyKey', () => {
  it('接受合法字符串头（大小写不敏感）', () => {
    expect(getIdempotencyKey({ 'idempotency-key': 'abcd1234' })).toBe('abcd1234')
    expect(getIdempotencyKey({ 'Idempotency-Key': 'abcd1234' })).toBe('abcd1234')
  })

  it('拒绝过短 / 过长 / 非字符串', () => {
    expect(getIdempotencyKey({ 'idempotency-key': 'short' })).toBeNull()
    expect(getIdempotencyKey({ 'idempotency-key': 'x'.repeat(201) })).toBeNull()
    expect(getIdempotencyKey({})).toBeNull()
    expect(getIdempotencyKey({ 'idempotency-key': 123 } as unknown as Record<string, unknown>)).toBeNull()
  })
})
