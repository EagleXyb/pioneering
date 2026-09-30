// P1-18：配置分层优先级 default → yaml → env（env 最高）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { getConfig, resetConfig, readEnvOverrides } from '@/config/runtime-config.js'
import { deepMergeConfig } from '@/config/yaml-loader.js'

describe('P1-18 · 环境变量配置最高优先级', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ['MODU_LLM_PROVIDER', 'MODU_LLM_TEMPERATURE', 'MODU_MEMORY_STRATEGY']) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    resetConfig()
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetConfig()
  })

  it('readEnvOverrides 只包含已设置的变量（稀疏字典）', () => {
    expect(readEnvOverrides()).toEqual({})
    process.env.MODU_LLM_PROVIDER = 'openai'
    expect(readEnvOverrides()).toEqual({ llm: { default_provider: 'openai' } })
  })

  it('温度解析为 number', () => {
    process.env.MODU_LLM_TEMPERATURE = '0.2'
    expect(readEnvOverrides().llm.temperature).toBe(0.2)
  })

  it('分层合并：env 覆盖 yaml 同名字段，yaml 其余字段保留', () => {
    const yamlLayer = {
      llm: { default_provider: 'azure', temperature: 0.9, model: 'gpt-4o' },
      memory: { default_strategy: 'chroma' },
    }
    process.env.MODU_LLM_PROVIDER = 'openai'
    const merged = deepMergeConfig(structuredClone(yamlLayer), readEnvOverrides())

    // env 胜出
    expect(merged.llm.default_provider).toBe('openai')
    // yaml 独有/未被 env 覆盖的字段保留
    expect(merged.llm.temperature).toBe(0.9)
    expect(merged.llm.model).toBe('gpt-4o')
    expect(merged.memory.default_strategy).toBe('chroma')
  })

  it('getConfig 无 yaml 时 env 仍生效（降级路径不回归）', () => {
    process.env.MODU_LLM_PROVIDER = 'openai'
    process.env.MODU_MEMORY_STRATEGY = 'cache'
    const cfg = getConfig()
    expect(cfg.get('llm.default_provider', null)).toBe('openai')
    expect(cfg.get('memory.default_strategy', null)).toBe('cache')
    expect(cfg.getSources()['env.MODU_LLM_PROVIDER']).toBe('llm.default_provider')
  })
})
