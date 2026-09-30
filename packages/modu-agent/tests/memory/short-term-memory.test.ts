import { describe, it, expect } from 'vitest'
import { InMemoryShortTermMemory } from '@/memory/short-term-memory.js'

describe('InMemoryShortTermMemory', () => {
  it('stores and queries history with required fields', () => {
    const mem = new InMemoryShortTermMemory(5, 3600)
    mem.update('u1', { role: 'user', content: 'hi' }, { session_id: 's1' })
    mem.update('u1', { role: 'assistant', content: 'hello' }, { session_id: 's1' })
    const r = mem.query('u1', 'last_5_turns', ['role', 'content'])
    expect(r.history.length).toBe(2)
    expect(r.history[0]).toEqual({ role: 'user', content: 'hi' })
  })

  it('returns empty history for unknown user', () => {
    const mem = new InMemoryShortTermMemory()
    expect(mem.query('nobody', 'last_5_turns', ['role']).history).toEqual([])
  })

  it('honors context window size', () => {
    const mem = new InMemoryShortTermMemory(5, 3600)
    for (let i = 0; i < 5; i++) {
      mem.update('u1', { n: i }, { session_id: 's1' })
    }
    const all = mem.query('u1', 'last_5_turns', ['n'])
    expect(all.history.length).toBe(5)
    const recent = mem.query('u1', 'last_2_turns', ['n'])
    expect(recent.history.length).toBe(2)
    expect(recent.history[1].n).toBe(4)
  })

  it('evicts entries older than ttl', async () => {
    const mem = new InMemoryShortTermMemory(5, 0.01) // 10ms ttl
    mem.update('u1', { v: 1 }, { session_id: 's1', timestamp: 0 })
    await new Promise((r) => setTimeout(r, 30))
    // A fresh update should not resurrect the expired one.
    mem.update('u1', { v: 2 }, { session_id: 's1' })
    const r = mem.query('u1', 'last_5_turns', ['v'])
    expect(r.history.length).toBe(1)
    expect(r.history[0].v).toBe(2)
  })

  // === P1-10：毫秒时间戳钳制 / 空键清理 / 全量 sweep ===
  describe('P1-10 内存边界治理', () => {
    it('毫秒时间戳（>1e12）写入时自动换算为秒，TTL 判定量纲一致', () => {
      const mem = new InMemoryShortTermMemory(5, 3600)
      const msNow = Date.now() // 13 位毫秒
      mem.update('u1', { v: 1 }, { session_id: 's1', timestamp: msNow })

      const r = mem.query('u1', 'last_1_turns', ['v', '_timestamp'])
      expect(r.history[0]['_timestamp']).toBeCloseTo(msNow / 1000, 1)
      expect(r.history[0]['_timestamp']).toBeLessThan(1e12)
    })

    it('显式秒级时间戳与缺省时间戳不被错误换算', () => {
      const mem = new InMemoryShortTermMemory(5, 3600)
      const recentSec = Date.now() / 1000 - 60 // 60s 前，在 TTL 内
      mem.update('u1', { v: 'sec' }, { session_id: 's1', timestamp: recentSec })
      mem.update('u1', { v: 'now' }, { session_id: 's1' })
      const r = mem.query('u1', 'last_2_turns', ['v', '_timestamp'])
      expect(r.history).toHaveLength(2)
      expect(r.history[0]['_timestamp']).toBeCloseTo(recentSec, 1)
      expect(r.history[1]['_timestamp']).toBeGreaterThan(1e9)
      expect(r.history[1]['_timestamp']).toBeLessThan(1e12)
    })

    it('过期清空后删除 userId 空键（Map 不残留空数组）', () => {
      const mem = new InMemoryShortTermMemory(5, 10)
      mem.update('ghost', { v: 1 }, { session_id: 's1', timestamp: 0 })
      expect((mem as any)._store.has('ghost')).toBe(true)

      mem.query('ghost', 'last_5_turns', ['v'])
      expect(mem.query('ghost', 'last_5_turns', ['v']).history).toEqual([])
      expect((mem as any)._store.has('ghost')).toBe(false)
    })

    it('节流全量 sweep：只写不读用户的过期条目在任意访问时被回收', () => {
      // sweepInterval=0 → 每次 query/update 都允许全量 sweep
      const mem = new InMemoryShortTermMemory(5, 10, 0)
      const nowSec = Date.now() / 1000

      // B 是"只写不读"用户，条目已过期（20s 前）
      mem.update('user-b', { v: 1 }, { session_id: 's', timestamp: nowSec - 20 })
      // A 是活跃用户，条目新鲜
      mem.update('user-a', { v: 9 }, { session_id: 's', timestamp: nowSec })

      // 访问 A 触发全量 sweep（不是只清 A 自己）
      mem.query('user-a', 'last_5_turns', ['v'])

      expect(mem.query('user-a', 'last_5_turns', ['v']).history).toHaveLength(1)
      expect((mem as any)._store.has('user-b')).toBe(false)
    })

    it('默认节流间隔常量为 60s', () => {
      expect(InMemoryShortTermMemory.DEFAULT_SWEEP_INTERVAL_SECONDS).toBe(60)
    })
  })
})
