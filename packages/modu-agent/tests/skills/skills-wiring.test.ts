// P0/P1-c 装配接线冒烟测试
//
// 目的：验证 `create_agent` 在以下组合下可正常装配（不抛异常、不破坏默认路径）：
//   1. skills.enabled=true + 请求选择 ['math']（工具裁剪 + 提示 only）
//   2. 叠加 progressive_disclosure.enabled=true（目录注入 + load_skill 注册）
//   3. 请求选择 []（明确不使用技能）
//   4. 默认配置（skills 关闭）仍可装配
//
// 说明：create_agent 只构造 ChatOpenAI（不发网络请求），故仅需假的 API Key。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { create_agent } from '@/graph/factory.js'
import { getRegistry, resetRegistry } from '@/core/registry.js'
import { RuntimeConfig, resetConfig } from '@/config/runtime-config.js'
import { BaseSkill } from '@/core/interfaces/skill.js'
import { CalculatorTool } from '@/tools/calculator.js'

const _SAVED: Record<string, string | undefined> = {}
const _ENV_KEYS = ['MODU_DEEPSEEK_API_KEY'] as const

class MathLikeSkill extends BaseSkill {
  name(): string {
    return 'math'
  }
  description(): string {
    return '数学计算与表达式求值能力。支持加减乘除。'
  }
  version(): string {
    return '1.0.0'
  }
  systemPromptFragment(): string | null {
    return 'USE CALCULATOR'
  }
  examples(): Array<Record<string, string>> {
    return [{ input: '1+1', output: '2' }]
  }
  tools() {
    return [new CalculatorTool()]
  }
}

function cfg(overrides: Record<string, any> = {}): RuntimeConfig {
  return new RuntimeConfig({
    llm: { default_provider: 'deepseek' },
    memory: { checkpointer_type: 'memory', store_type: 'in_memory' },
    mcp: { enabled: false },
    skills: {
      enabled: true,
      auto_discover_dirs: [],
      active: [],
      progressive_disclosure: { enabled: false, catalog_max_chars: 2000, load_max_chars: 6000 },
    },
    tools: { register_defaults: true },
    ...overrides,
  })
}

beforeEach(() => {
  for (const k of _ENV_KEYS) {
    if (!(k in _SAVED)) _SAVED[k] = process.env[k]
  }
  process.env.MODU_DEEPSEEK_API_KEY = 'sk-test-skills-wiring'
  resetConfig()
  resetRegistry()
})

afterEach(() => {
  resetConfig()
  resetRegistry()
  for (const k of _ENV_KEYS) {
    const v = _SAVED[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const k of Object.keys(_SAVED)) delete _SAVED[k]
})

describe('create_agent · Skills 装配接线', () => {
  it('默认配置（skills 关闭）可装配：toolNames 不裁剪', async () => {
    const graph = await create_agent(null, cfg({ skills: { enabled: false } }))
    expect(graph).toBeTruthy()
    expect(getRegistry().listSkills()).toEqual({})
  })

  it('skills 开启 + 选择 [math]：装配成功并注册技能', async () => {
    getRegistry().registerSkill(new MathLikeSkill())
    const graph = await create_agent(
      { configurable: { skills: ['math'] } },
      cfg(),
    )
    expect(graph).toBeTruthy()
    expect(Object.keys(getRegistry().listSkills())).toContain('math')
  })

  it('叠加渐进式披露：装配成功（load_skill 与目录注入路径可达）', async () => {
    getRegistry().registerSkill(new MathLikeSkill())
    const graph = await create_agent(
      { configurable: { skills: ['math'] } },
      cfg({
        skills: {
          enabled: true,
          auto_discover_dirs: [],
          active: [],
          progressive_disclosure: { enabled: true, catalog_max_chars: 2000, load_max_chars: 6000 },
        },
      }),
    )
    expect(graph).toBeTruthy()
  })

  it('选择 []（明确不使用技能）：装配成功，内置工具不受影响', async () => {
    getRegistry().registerSkill(new MathLikeSkill())
    const graph = await create_agent({ configurable: { skills: [] } }, cfg())
    expect(graph).toBeTruthy()
    // 内置工具仍在注册表中（裁剪只作用于绑定集，不注销）
    expect(getRegistry().getTool('datetime')).toBeDefined()
  })

  it('选择未注册技能：忽略并正常装配（fail-soft）', async () => {
    const graph = await create_agent(
      { configurable: { skills: ['not-exist'] } },
      cfg(),
    )
    expect(graph).toBeTruthy()
  })
})
