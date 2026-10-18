/**
 * P4 回归：分层限流（固定窗口）
 */
import { describe, it, expect } from 'vitest'
import { FixedWindowLimiter } from '../src/plugins/rate-limit.ts'

describe('FixedWindowLimiter', () => {
  it('达到上限后拒绝，窗口滚动后恢复', () => {
    let now = 1_000
    const limiter = new FixedWindowLimiter({
      limit: 2,
      windowMs: 60_000,
      now: () => now,
    })

    expect(limiter.hit('u1')).toBe(true)
    expect(limiter.hit('u1')).toBe(true)
    expect(limiter.hit('u1')).toBe(false)
    expect(limiter.remaining('u1')).toBe(0)

    now += 60_000
    expect(limiter.hit('u1')).toBe(true)
  })

  it('不同 key 互不影响', () => {
    const limiter = new FixedWindowLimiter({ limit: 1, now: () => 1_000 })
    expect(limiter.hit('u1')).toBe(true)
    expect(limiter.hit('u2')).toBe(true)
    expect(limiter.hit('u1')).toBe(false)
  })

  it('limit=0 表示不限制', () => {
    const limiter = new FixedWindowLimiter({ limit: 0, now: () => 1_000 })
    for (let i = 0; i < 100; i++) expect(limiter.hit('u1')).toBe(true)
  })
})
