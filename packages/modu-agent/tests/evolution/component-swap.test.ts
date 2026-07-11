import { describe, it, expect } from 'vitest'
import { ComponentSwapStrategy } from '@/evolution/component-swap.js'

function fakeRegistry() {
  return {}
}
function fakeCollector() {
  return {}
}

describe('ComponentSwapStrategy', () => {
  it('reports no swap without enough history', () => {
    const s = new ComponentSwapStrategy(fakeRegistry() as any, fakeCollector() as any)
    expect(s.shouldSwap('comp', 'v1', 'v2')).toBe(false)
  })

  it('swaps when candidate clearly outperforms current', () => {
    const s = new ComponentSwapStrategy(fakeRegistry() as any, fakeCollector() as any)
    s.recordScore('comp', 'v1', 0.5)
    s.recordScore('comp', 'v1', 0.5)
    s.recordScore('comp', 'v2', 0.85)
    s.recordScore('comp', 'v2', 0.85)
    expect(s.shouldSwap('comp', 'v1', 'v2')).toBe(true)
  })

  it('does not swap for a marginal improvement below threshold', () => {
    const s = new ComponentSwapStrategy(fakeRegistry() as any, fakeCollector() as any, 0.05)
    s.recordScore('comp', 'v1', 0.5)
    s.recordScore('comp', 'v2', 0.52)
    expect(s.shouldSwap('comp', 'v1', 'v2', 0.05)).toBe(false)
  })
})
