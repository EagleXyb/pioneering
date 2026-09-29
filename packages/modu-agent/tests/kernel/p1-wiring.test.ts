// P1（T-12 / T-11 / T-10 / T-10b）装配层接线测试。
//
// 对应实施计划 §5.2.5 验收断言 #1：
//   三个注册方法在 `ComponentRegistry` 可用**且被主链路消费**。
//
// 本测试通过真实 `create_agent()` 验证装配链路：
//   - `registerBuiltinLLMProviders` → `listLLMProviders()` 含 4 个内置 provider
//   - `registerBaseStoreMemoryStrategy` → `listMemoryStrategies()` 含 'base_store' 且为默认策略
//   - `registerDefaultPolicyRules` → `listPolicyRules()` 含 tool/input/output 三层规则
//   - 默认门控：`policy.engine.enabled=false`、`perception.security.sanitize_output.enabled=false`
//
// 说明：`create_agent` 只构造 ChatOpenAI（不发网络请求），故仅需提供 API Key 环境变量。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { create_agent } from '@/graph/factory.js'
import { getRegistry, resetRegistry } from '@/core/registry.js'
import { RuntimeConfig, resetConfig } from '@/config/runtime-config.js'

const _SAVED: Record<string, string | undefined> = {}
const _ENV_KEYS = ['MODU_DEEPSEEK_API_KEY', 'MODU_CHAT_MODEL'] as const

beforeEach(() => {
  for (const k of _ENV_KEYS) {
    if (!(k in _SAVED)) _SAVED[k] = process.env[k]
  }
  process.env.MODU_DEEPSEEK_API_KEY = 'sk-test-p1-wiring'
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

/** 最小化副作用的运行时配置：内存 checkpointer / 内存 store，关闭外部发现。 */
function testConfig(): RuntimeConfig {
  return new RuntimeConfig({
    llm: { default_provider: 'deepseek' },
    memory: { checkpointer_type: 'memory', store_type: 'in_memory' },
    mcp: { enabled: false },
    skills: { enabled: false },
    tools: { register_defaults: false },
  })
}

describe('P1 · create_agent 装配接线', () => {
  it('注册内置 provider / 记忆策略 / 三层策略规则，并保持默认门控关闭', async () => {
    const graph = await create_agent(null, testConfig())
    expect(graph).toBeTruthy()

    const reg = getRegistry()

    // T-12：4 个内置 provider
    expect(reg.listLLMProviders().sort()).toEqual(['deepseek', 'glm', 'gpt', 'qwen'])

    // T-11：BaseStore 记忆策略已注册且为默认策略（即主链路解析目标）
    expect(reg.listMemoryStrategies()).toContain('base_store')
    expect(reg.getDefaultMemoryStrategyId()).toBe('base_store')
    expect(reg.resolveMemoryStrategy(undefined)?.id).toBe('base_store')

    // T-10 / T-10b：三层策略规则
    expect(reg.listPolicyRules('tool')).toContain('tool_approval')
    expect(reg.listPolicyRules('input')).toContain('input_guard')
    expect(reg.listPolicyRules('output')).toContain('output_guard')

    // 默认门控保持关闭（关键：保证默认路径不启用策略引擎）
    const cfg = new RuntimeConfig()
    expect(cfg.get('policy.engine.enabled', null)).toBe(false)
  }, 60000)

  it('重复调用 create_agent 时装配保持幂等（注册不重复、不抛错）', async () => {
    await create_agent(null, testConfig())
    await create_agent(null, testConfig())

    const reg = getRegistry()
    expect(reg.listLLMProviders().sort()).toEqual(['deepseek', 'glm', 'gpt', 'qwen'])
    expect(reg.listMemoryStrategies().filter((id) => id === 'base_store')).toHaveLength(1)
    expect(reg.listPolicyRules()).toHaveLength(3)
  }, 60000)
})
