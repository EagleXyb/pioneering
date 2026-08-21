// p5-env-capability.test.ts
//
// 环境变量统一治理（env.ts）+ 配置能力注册表（capability-registry.ts）测试。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ENV_VAR_REGISTRY,
  groupEnvVarsByCategory,
  readEnvVar,
  collectEnvSources,
  auditEnvVars,
  SENSITIVE_KEY_RE,
} from '@/config/env.js'
import {
  CAPABILITY_REGISTRY,
  UNDECLARED_CONSUMED_KEYS,
  listCapabilities,
  listEnabledKeys,
  capabilityStatus,
} from '@/config/capability-registry.js'

// 保存/恢复环境变量，避免污染其他测试
const SAVED: Record<string, string | undefined> = {}
function setEnv(name: string, value: string) {
  if (!(name in SAVED)) SAVED[name] = process.env[name]
  process.env[name] = value
}
function clearEnv(name: string) {
  if (!(name in SAVED)) SAVED[name] = process.env[name]
  delete process.env[name]
}

beforeEach(() => {})
afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const k of Object.keys(SAVED)) delete SAVED[k]
})

describe('env.ts 环境变量统一治理', () => {
  it('注册表覆盖全部已知环境变量且无重名', () => {
    const names = ENV_VAR_REGISTRY.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
    // 关键变量必须在列
    for (const n of ['MODU_GLM_API_KEY', 'MODU_DEEPSEEK_API_KEY', 'LLM_API_KEY',
      'MODU_LLM_PROVIDER', 'MODU_MEMORY_STRATEGY', 'MODU_CHROMA_PATH',
      'TAVILY_API_KEY', 'MODU_FILE_OPS_ROOT', 'MODU_DOC_WRITER_ROOT', 'MODU_CONFIG_PATH']) {
      expect(names).toContain(n)
    }
  })

  it('敏感变量均标记 sensitive=true', () => {
    for (const d of ENV_VAR_REGISTRY) {
      if (SENSITIVE_KEY_RE.test(d.name)) {
        expect(d.sensitive).toBe(true)
      }
    }
  })

  it('进入 RuntimeConfig 的变量带 configKey，其余不带', () => {
    for (const d of ENV_VAR_REGISTRY) {
      if (d.inRuntimeConfig) {
        expect(d.configKey).toBeTruthy()
      } else {
        expect(d.configKey).toBeUndefined()
      }
    }
  })

  it('groupEnvVarsByCategory 正确分组', () => {
    const g = groupEnvVarsByCategory()
    expect(g.llm_connection.length).toBeGreaterThan(0)
    expect(g.proxy.map((d) => d.name)).toEqual(['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'])
  })

  it('readEnvVar 返回设置值、未设置返回 null', () => {
    setEnv('MODU_LLM_PROVIDER', 'qwen')
    expect(readEnvVar('MODU_LLM_PROVIDER')).toBe('qwen')
    clearEnv('MODU_LLM_PROVIDER')
    expect(readEnvVar('MODU_LLM_PROVIDER')).toBeNull()
  })

  it('collectEnvSources 仅列已设置变量且敏感值脱敏', () => {
    clearEnv('MODU_GLM_API_KEY')
    clearEnv('MODU_LLM_PROVIDER')
    setEnv('MODU_GLM_API_KEY', 'sk-123456')
    setEnv('MODU_LLM_PROVIDER', 'deepseek')
    const s = collectEnvSources({ maskSensitive: true })
    expect(s['MODU_GLM_API_KEY']).toBe('***')
    expect(s['MODU_LLM_PROVIDER']).toBe('deepseek')
    expect(s['MODU_DEEPSEEK_API_KEY']).toBeUndefined() // 未设置不出现
  })

  it('collectEnvSources 关闭脱敏时返回原始值', () => {
    setEnv('MODU_GLM_API_KEY', 'sk-123456')
    const s = collectEnvSources({ maskSensitive: false })
    expect(s['MODU_GLM_API_KEY']).toBe('sk-123456')
  })

  it('auditEnvVars 统计已注册/未注册/敏感已设置', () => {
    setEnv('MODU_GLM_API_KEY', 'sk-123456')
    setEnv('NOT_REGISTERED_CUSTOM', 'x')
    const r = auditEnvVars()
    expect(r.registered).toBeGreaterThanOrEqual(1)
    expect(r.unregistered).toBeGreaterThanOrEqual(1)
    expect(r.sensitiveSet).toBeGreaterThanOrEqual(1)
  })
})

describe('capability-registry.ts 配置能力注册表', () => {
  it('已实现能力均含 enabledKey（除 llm_as_judge 等无单一开关者）', () => {
    for (const c of listCapabilities({ status: 'implemented' })) {
      if (c.id !== 'llm_as_judge') {
        expect(c.enabledKey).toBeTruthy()
      }
    }
  })

  it('listCapabilities 按状态过滤', () => {
    expect(listCapabilities({ status: 'planned' }).length).toBeGreaterThan(0)
    expect(listCapabilities({ status: 'planned' }).every((c) => c.status === 'planned')).toBe(true)
  })

  it('listEnabledKeys 只返回已实现且有开关的能力', () => {
    const keys = listEnabledKeys()
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((k) => k.enabledKey && k.enabledKey.endsWith('.enabled'))).toBe(true)
  })

  it('capabilityStatus 反映配置当前启用状态', () => {
    const fake = {
      get(k: string, d?: any) {
        if (k === 'react_optimization.markdown_prompt.enabled') return true
        return d
      },
    }
    const st = capabilityStatus(fake)
    expect(st.markdown_prompt).toBe(true)
    expect(st.prompt_composer).toBe(false) // 未覆盖 → fallback default false
  })

  it('UNDECLARED_CONSUMED_KEYS 记录声明/消费脱节的键', () => {
    expect(UNDECLARED_CONSUMED_KEYS).toContain('plan_execute.planner_max_tokens')
    expect(UNDECLARED_CONSUMED_KEYS).toContain('plan_execute.step_retry.default_max_attempts')
    expect(UNDECLARED_CONSUMED_KEYS).toContain('plan_execute.step_retry.default_base_delay')
  })

  it('CAPABILITY_REGISTRY 中 planned 项不含真实实现路径', () => {
    const planned = listCapabilities({ status: 'planned' })
    // behavior/factory_config/testing_config 应为空实现
    for (const id of ['behavior', 'factory_config', 'testing_config']) {
      const c = planned.find((x) => x.id === id)
      expect(c).toBeTruthy()
      expect(c!.implementation.length).toBe(0)
    }
  })
})
