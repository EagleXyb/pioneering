import { describe, it, expect, afterEach } from 'vitest'
import {
  RuntimeConfig,
  getConfig,
  resetConfig,
  overrideConfig,
} from '@/config/runtime-config.js'

describe('RuntimeConfig', () => {
  it('loads DEFAULT_CONFIG values', () => {
    const cfg = new RuntimeConfig()
    expect(cfg.get('llm.default_provider', null)).toBe('deepseek')
    expect(cfg.get('llm.temperature', null)).toBe(0.7)
    expect(cfg.get('feedback.evolution_threshold', null)).toBe(0.6)
  })

  it('returns the provided default for missing keys', () => {
    const cfg = new RuntimeConfig()
    expect(cfg.get('does.not.exist', 'fallback')).toBe('fallback')
  })

  it('merges constructor overrides deeply', () => {
    const cfg = new RuntimeConfig({ llm: { temperature: 0.9 }, feedback: { min_sample_size: 5 } })
    expect(cfg.get('llm.temperature', null)).toBe(0.9)
    expect(cfg.get('llm.max_tokens', null)).toBe(512) // untouched default
    expect(cfg.get('feedback.min_sample_size', null)).toBe(5)
  })

  it('update returns the old value and applies the change', () => {
    const cfg = new RuntimeConfig()
    const old = cfg.update('llm.temperature', 0.3)
    expect(old).toBe(0.7)
    expect(cfg.get('llm.temperature', null)).toBe(0.3)
  })

  it('updateMany updates several keys atomically', () => {
    const cfg = new RuntimeConfig()
    const olds = cfg.updateMany({
      'llm.temperature': 0.1,
      'llm.max_reasoning_iterations': 7,
    })
    expect(olds['llm.temperature']).toBe(0.7)
    expect(cfg.get('llm.temperature', null)).toBe(0.1)
    expect(cfg.get('llm.max_reasoning_iterations', null)).toBe(7)
  })

  it('fires registered change callbacks', () => {
    const cfg = new RuntimeConfig()
    const seen: Array<any> = []
    const unregister = cfg.registerChangeCallback((kp, oldV, newV) => {
      seen.push({ kp, oldV, newV })
    })
    cfg.update('llm.temperature', 0.42)
    expect(seen.length).toBe(1)
    expect(seen[0].kp).toBe('llm.temperature')
    expect(seen[0].newV).toBe(0.42)
    unregister()
    cfg.update('llm.temperature', 0.43)
    expect(seen.length).toBe(1) // not fired after unregister
  })

  it('asDict returns a deep copy', () => {
    const cfg = new RuntimeConfig()
    const d = cfg.asDict()
    d.llm.temperature = 0.0
    expect(cfg.get('llm.temperature', null)).toBe(0.7)
  })
})

describe('getConfig singleton', () => {
  afterEach(() => {
    resetConfig()
  })

  it('overrideConfig replaces and restores the global config', () => {
    const base = getConfig()
    const custom = new RuntimeConfig({ llm: { temperature: 0.123 } })
    const scope = overrideConfig(custom)
    expect(getConfig().get('llm.temperature', null)).toBe(0.123)
    scope.restore()
    expect(getConfig()).toBe(base)
  })
})
