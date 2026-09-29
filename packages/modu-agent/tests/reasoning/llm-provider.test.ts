// P1（T-12）LLM provider 注册表测试。
//
// 背景：改造前 `tests/` 下**无任何** llm/router/provider 测试（见实施计划 §0.1 #10）。
// 本文件补齐 provider 收口的回归锚点：
//   1. 内置规格表与改造前 `_PROVIDER_CONFIG` 逐项等价
//   2. `registerBuiltinLLMProviders` 幂等且**宿主覆盖优先**
//   3. 宿主注册的自定义 provider 可被 `build_chat_model` 直接使用（横向可替换验收）
//   4. env 解析顺序：显式参数 > 主 env > 别名 env > 通用 LLM_* > 默认值
//   5. 未知 provider 回退 glm、默认 provider 次级兜底为 deepseek（与 DEFAULT_CONFIG 一致）
//
// 说明：本测试**不发网络请求**，仅构造 ChatOpenAI 实例并断言其字段。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import type { LLMProviderFactory, LLMProviderSpec } from '@/core/interfaces/llm-provider.js'
import { ComponentRegistry } from '@/core/registry.js'
import {
  build_chat_model,
  listBuiltinLLMProviders,
  registerBuiltinLLMProviders,
} from '@/graph/adapters/llm-adapter.js'
import { BUILTIN_LLM_PROVIDER_SPECS } from '@/graph/adapters/llm-provider-registry.js'

// ---------------------------------------------------------------------------
// env 隔离（避免污染其他测试）
// ---------------------------------------------------------------------------
const _ENV_KEYS = [
  'MODU_GLM_API_KEY', 'MODU_GLM_BASE_URL', 'MODU_GLM_MODEL',
  'MODU_DEEPSEEK_API_KEY', 'MODU_DEEPSEEK_BASE_URL', 'MODU_DEEPSEEK_MODEL',
  'MODU_QWEN_API_KEY', 'MODU_QWEN_BASE_URL', 'MODU_QWEN_MODEL',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL',
  'MODU_OPENAI_API_KEY', 'MODU_OPENAI_BASE_URL', 'MODU_OPENAI_MODEL',
  'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_DEFAULT_MODEL',
] as const

const _SAVED: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of _ENV_KEYS) {
    if (!(k in _SAVED)) _SAVED[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of _ENV_KEYS) {
    const v = _SAVED[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const k of Object.keys(_SAVED)) delete _SAVED[k]
})

/** 构造最小 RuntimeConfig 替身（仅提供 get）。 */
function fakeConfig(overrides: Record<string, any> = {}): any {
  return {
    get(key: string, fallback?: any) {
      if (key in overrides) return overrides[key]
      return fallback
    },
  }
}

/** 未注册任何 factory 的隔离注册表（build_chat_model 会按需兜底注册内置）。 */
function freshRegistry(): ComponentRegistry {
  return new ComponentRegistry()
}

describe('P1-T12 · 内置 provider 规格表', () => {
  it('内置 4 个 provider，且默认值与改造前 _PROVIDER_CONFIG 逐项等价', () => {
    const byId = new Map(BUILTIN_LLM_PROVIDER_SPECS.map((s) => [s.id, s]))
    expect([...byId.keys()].sort()).toEqual(['deepseek', 'glm', 'gpt', 'qwen'])

    // 改造前 llm-adapter.ts:22-51 的确切值
    expect(byId.get('glm')).toMatchObject({
      apiKeyEnv: 'MODU_GLM_API_KEY',
      defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-4-flash',
    })
    expect(byId.get('deepseek')).toMatchObject({
      apiKeyEnv: 'MODU_DEEPSEEK_API_KEY',
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
    })
    expect(byId.get('gpt')).toMatchObject({
      apiKeyEnv: 'OPENAI_API_KEY',
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini',
    })
    expect(byId.get('qwen')).toMatchObject({
      apiKeyEnv: 'MODU_QWEN_API_KEY',
      defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      defaultModel: 'qwen-plus',
    })
  })

  it('gpt 的第二轨（MODU_OPENAI_*）降级为别名而非主 env', () => {
    const gpt = BUILTIN_LLM_PROVIDER_SPECS.find((s) => s.id === 'gpt')!
    // 主 env 以在用约定为准
    expect(gpt.apiKeyEnv).toBe('OPENAI_API_KEY')
    expect(gpt.modelEnv).toBe('OPENAI_MODEL')
    // 第二轨作为别名保留，避免宿主配置静默失效（R-09 缓解）
    expect(gpt.apiKeyEnvAliases).toContain('MODU_OPENAI_API_KEY')
    expect(gpt.baseUrlEnvAliases).toContain('MODU_OPENAI_BASE_URL')
    expect(gpt.modelEnvAliases).toContain('MODU_OPENAI_MODEL')
  })

  it('listBuiltinLLMProviders 暴露 id / defaultModel / apiKeyEnv', () => {
    const list = listBuiltinLLMProviders()
    expect(list.map((p) => p.id).sort()).toEqual(['deepseek', 'glm', 'gpt', 'qwen'])
    expect(list.find((p) => p.id === 'deepseek')!.defaultModel).toBe('deepseek-v4-flash')
  })
})

describe('P1-T12 · provider 注册表', () => {
  it('registerBuiltinLLMProviders 幂等（重复调用不再注册）', () => {
    const reg = freshRegistry()
    const first = registerBuiltinLLMProviders(reg)
    expect(first.sort()).toEqual(['deepseek', 'glm', 'gpt', 'qwen'])
    expect(reg.listLLMProviders().sort()).toEqual(['deepseek', 'glm', 'gpt', 'qwen'])

    const second = registerBuiltinLLMProviders(reg)
    expect(second).toEqual([])
  })

  it('宿主注册同 id provider 时不被内置实现覆盖（覆盖优先）', () => {
    const reg = freshRegistry()
    const sentinel = { model: 'host-override' } as any
    const hostSpec: LLMProviderSpec = {
      id: 'glm',
      defaultModel: 'host-model',
      defaultBaseUrl: 'https://host.example/v1',
      apiKeyEnv: 'HOST_API_KEY',
      baseUrlEnv: 'HOST_BASE_URL',
      modelEnv: 'HOST_MODEL',
    }
    const hostFactory: LLMProviderFactory = {
      id: 'glm',
      defaultModel: 'host-model',
      defaultBaseUrl: 'https://host.example/v1',
      apiKeyEnv: 'HOST_API_KEY',
      spec: hostSpec,
      create: () => sentinel,
    }
    reg.registerLLMProvider(hostFactory)

    registerBuiltinLLMProviders(reg)

    expect(reg.getLLMProvider('glm')).toBe(hostFactory)
    expect(build_chat_model('glm', fakeConfig(), null, null, null, reg)).toBe(sentinel)
  })

  it('宿主可注册全新 provider 并被 build_chat_model 直接使用（横向可替换）', () => {
    const reg = freshRegistry()
    const captured: Array<Record<string, any>> = []
    const sentinel = { model: 'my-llm-model' } as any
    const spec: LLMProviderSpec = {
      id: 'my-llm',
      defaultModel: 'my-llm-model',
      defaultBaseUrl: 'https://my-llm.example/v1',
      apiKeyEnv: 'MY_LLM_API_KEY',
      baseUrlEnv: 'MY_LLM_BASE_URL',
      modelEnv: 'MY_LLM_MODEL',
    }
    reg.registerLLMProvider({
      id: spec.id,
      defaultModel: spec.defaultModel,
      defaultBaseUrl: spec.defaultBaseUrl,
      apiKeyEnv: spec.apiKeyEnv,
      spec,
      create(cfg) {
        captured.push(cfg as unknown as Record<string, any>)
        return sentinel
      },
    })

    const out = build_chat_model('my-llm', fakeConfig(), 0.15, 128, 'm-override', reg)

    expect(out).toBe(sentinel)
    expect(captured).toHaveLength(1)
    // 显式参数须原样透传给 factory
    expect(captured[0]).toMatchObject({
      provider: 'my-llm',
      model: 'm-override',
      temperature: 0.15,
      maxTokens: 128,
    })
  })

  it('registerLLMProvider 拒绝空 id', () => {
    const reg = freshRegistry()
    expect(() => reg.registerLLMProvider({ id: '' } as any)).toThrow(TypeError)
  })
})

describe('P1-T12 · env 解析顺序（显式 > 主 env > 别名 env > 通用 LLM_* > 默认值）', () => {
  it('model：显式参数优先于一切 env', () => {
    const reg = freshRegistry()
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.OPENAI_MODEL = 'env-primary'
    process.env.MODU_OPENAI_MODEL = 'env-alias'

    const m = build_chat_model('gpt', fakeConfig(), null, null, 'explicit-model', reg) as any
    expect(m.model).toBe('explicit-model')
  })

  it('model：主 env 优先于别名 env', () => {
    const reg = freshRegistry()
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.OPENAI_MODEL = 'env-primary'
    process.env.MODU_OPENAI_MODEL = 'env-alias'

    const m = build_chat_model('gpt', fakeConfig(), null, null, null, reg) as any
    expect(m.model).toBe('env-primary')
  })

  it('model：只有别名 env 时使用别名（第二轨兼容）', () => {
    const reg = freshRegistry()
    process.env.MODU_OPENAI_API_KEY = 'sk-alias'

    const m = build_chat_model('gpt', fakeConfig(), null, null, null, reg) as any
    expect(m.model).toBe('gpt-4o-mini')
    // 别名 API Key 被采用（否则 ChatOpenAI 构造会抛错）
    expect(m.apiKey).toBe('sk-alias')
  })

  it('model：通用 LLM_DEFAULT_MODEL 作为倒数第二级兜底', () => {
    const reg = freshRegistry()
    process.env.MODU_GLM_API_KEY = 'sk-test'
    process.env.LLM_DEFAULT_MODEL = 'generic-model'

    const m = build_chat_model('glm', fakeConfig(), null, null, null, reg) as any
    expect(m.model).toBe('generic-model')
  })

  it('temperature / max_tokens：显式参数 > 配置', () => {
    const reg = freshRegistry()
    process.env.MODU_GLM_API_KEY = 'sk-test'

    const explicit = build_chat_model('glm', fakeConfig(), 0.11, 99, null, reg) as any
    expect(explicit.temperature).toBe(0.11)
    expect(explicit.maxTokens).toBe(99)

    const fromConfig = build_chat_model(
      'glm',
      fakeConfig({ 'llm.temperature': 0.33, 'llm.max_tokens': 77 }),
      null, null, null, reg,
    ) as any
    expect(fromConfig.temperature).toBe(0.33)
    expect(fromConfig.maxTokens).toBe(77)
  })
})

describe('P1-T12 · 默认与降级行为', () => {
  it('provider 参数为空时读 llm.default_provider', () => {
    const reg = freshRegistry()
    process.env.MODU_QWEN_API_KEY = 'sk-test'

    const m = build_chat_model(
      null,
      fakeConfig({ 'llm.default_provider': 'qwen' }),
      null, null, null, reg,
    ) as any
    expect(m.model).toBe('qwen-plus')
  })

  it('llm.default_provider 缺失时次级兜底为 deepseek（与 DEFAULT_CONFIG 一致，非旧值 glm）', () => {
    const reg = freshRegistry()
    process.env.MODU_DEEPSEEK_API_KEY = 'sk-test'

    const m = build_chat_model(null, fakeConfig(), null, null, null, reg) as any
    expect(m.model).toBe('deepseek-v4-flash')
  })

  it('未知 provider 回退 glm（保持改造前行为）', () => {
    const reg = freshRegistry()
    process.env.MODU_GLM_API_KEY = 'sk-test'

    const m = build_chat_model('not-a-provider', fakeConfig(), null, null, null, reg) as any
    expect(m.model).toBe('glm-4-flash')
  })

  it('build_chat_model 未显式传 registry 时使用全局单例且不抛错', () => {
    process.env.MODU_DEEPSEEK_API_KEY = 'sk-test'
    const m = build_chat_model('deepseek', fakeConfig()) as any
    expect(m.model).toBe('deepseek-v4-flash')
  })
})
