import { describe, it, expect } from 'vitest'
import { ParameterTuneStrategy } from '@/evolution/parameter-tune.js'
import { EvolutionSignal } from '@/feedback/evolution-signal.js'

function fakeConfig() {
  return {
    get(key: string, def: any): any {
      const map: Record<string, any> = {
        'llm.temperature': 0.7,
        'llm.max_reasoning_iterations': 3,
      }
      return key in map ? map[key] : def
    },
  }
}

function fakeCollector() {
  return { getSignals: () => [] }
}

describe('ParameterTuneStrategy', () => {
  it('returns no adjustment when there are no signals', () => {
    const s = new ParameterTuneStrategy(fakeConfig() as any, fakeCollector() as any)
    const r = s.analyzeAndAdjust([])
    expect(r.adjusted).toBe(false)
    expect(r.config_overrides).toEqual({})
  })

  it('lowers temperature when accuracy is low', () => {
    const s = new ParameterTuneStrategy(fakeConfig() as any, fakeCollector() as any)
    const signals = [
      new EvolutionSignal('feedback', 'feedback', 0, { accuracy: 0.3 }, {}, 'high'),
    ]
    const r = s.analyzeAndAdjust(signals)
    expect(r.adjusted).toBe(true)
    expect(r.config_overrides.temperature).toBeCloseTo(0.6)
  })

  it('lowers max_iterations when iterations are high', () => {
    const s = new ParameterTuneStrategy(fakeConfig() as any, fakeCollector() as any)
    const signals = [
      new EvolutionSignal('reasoning', 'reasoning', 0, { iterations: 20 }, {}, 'high'),
    ]
    const r = s.analyzeAndAdjust(signals)
    expect(r.adjusted).toBe(true)
    expect(r.config_overrides.max_reasoning_iterations).toBe(1)
  })

  it('keeps temperature from rising on high tool-failure rate', () => {
    const s = new ParameterTuneStrategy(fakeConfig() as any, fakeCollector() as any)
    const signals = [
      new EvolutionSignal(
        'tool',
        'tool',
        0,
        { tool_failure_rate: 0.9 },
        { metadata: { tool_status: 'failed' } },
        'high',
      ),
    ]
    const r = s.analyzeAndAdjust(signals)
    expect(r.config_overrides.temperature ?? 0.7).toBeLessThanOrEqual(0.7)
  })
})
