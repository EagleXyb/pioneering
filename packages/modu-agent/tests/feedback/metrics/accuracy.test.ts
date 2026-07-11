import { describe, it, expect } from 'vitest'
import { AccuracyMetrics } from '@/feedback/metrics/accuracy.js'

describe('AccuracyMetrics', () => {
  const m = new AccuracyMetrics()

  it('returns zeros for empty input', () => {
    expect(m.calculate([])).toEqual({ success_rate: 0, error_rate: 0, avg_time: 0 })
  })

  it('computes success/error rates', () => {
    const r = m.calculate([
      { success: true, execution_time: 1.0 },
      { success: true, execution_time: 3.0 },
      { success: false, execution_time: 2.0 },
    ])
    expect(r.success_rate).toBeCloseTo(2 / 3)
    expect(r.error_rate).toBeCloseTo(1 / 3)
    expect(r.avg_time).toBeCloseTo(2.0)
  })

  it('treats only strict boolean true as success', () => {
    const r = m.calculate([{ success: 1 as any }, { success: 'yes' as any }])
    // 1 and "yes" are not strictly true -> both counted as errors
    expect(r.success_rate).toBe(0)
    expect(r.error_rate).toBe(1)
  })
})
