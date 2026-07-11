import { describe, it, expect } from 'vitest'
import { EfficiencyMetrics } from '@/feedback/metrics/efficiency.js'

describe('EfficiencyMetrics', () => {
  const m = new EfficiencyMetrics()

  it('computes token/iteration/throughput metrics', () => {
    const r = m.calculate({ input_tokens: 100, output_tokens: 50 }, 5, 1000)
    expect(r.token_efficiency).toBeCloseTo(0.5)
    expect(r.iteration_efficiency).toBeCloseTo(10)
    expect(r.tokens_per_second).toBeCloseTo(150)
  })

  it('returns zero token_efficiency when input is zero', () => {
    const r = m.calculate({ input_tokens: 0, output_tokens: 50 }, 5, 1000)
    expect(r.token_efficiency).toBe(0)
  })

  it('returns zero throughput when latency is zero', () => {
    const r = m.calculate({ input_tokens: 100, output_tokens: 50 }, 5, 0)
    expect(r.tokens_per_second).toBe(0)
  })
})
