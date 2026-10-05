import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { registerBuiltinPerceptionProcessors } from '@/perception/builtin-processors.js'
import { getRegistry, resetRegistry } from '@/core/registry.js'
import { overrideConfig, RuntimeConfig } from '@/config/runtime-config.js'

describe('T3-1 builtin processors follow routing', () => {
  beforeEach(() => resetRegistry())
  afterEach(() => {
    overrideConfig(new RuntimeConfig())
    resetRegistry()
  })
  const on = () =>
    new RuntimeConfig({ perception: { builtin_processors: { enabled: true } } })

  it('disabled by default', () => {
    expect(registerBuiltinPerceptionProcessors(getRegistry(), new RuntimeConfig())).toBe(0)
  })

  it('registers text pipeline processors', () => {
    registerBuiltinPerceptionProcessors(getRegistry(), on())
    expect(getRegistry().getPerception('text_preprocessor')).toBeTruthy()
    expect(getRegistry().getPerception('llm_parser')).toBeTruthy()
  })

  it('registers image and audio processors', () => {
    registerBuiltinPerceptionProcessors(getRegistry(), on())
    expect(getRegistry().getPerception('image_processor')).toBeTruthy()
    expect(getRegistry().getPerception('audio_processor')).toBeTruthy()
  })

  it('does not override host registration', () => {
    const registry = getRegistry()
    const custom = { name: () => 'host' } as any
    registry.registerPerception('text_preprocessor', custom)
    registerBuiltinPerceptionProcessors(registry, on())
    expect(registry.getPerception('text_preprocessor')).toBe(custom)
  })
})
