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
})
