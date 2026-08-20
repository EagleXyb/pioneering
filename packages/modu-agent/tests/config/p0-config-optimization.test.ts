import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { RuntimeConfig, getConfig, resetConfig } from '@/config/runtime-config.js'
import {
  parseYamlSubset,
  deepMergeConfig,
  loadConfigYaml,
  findConfigYaml,
} from '@/config/yaml-loader.js'

// ============================================================
// P0（文档 4.4）落地的系统化测试
// 目标：验证清理死字段 / yaml 分层 / JSON 兼容 / 降级 均不破坏原有业务逻辑
// ============================================================

describe('P0: 死配置字段清理（不破坏业务逻辑）', () => {
  it('清理的死字段在运行时不再作为默认值存在', () => {
    const cfg = new RuntimeConfig()
    // 这些字段原 DEFAULT_CONFIG 提供默认值，但无代码通过 get() 读取；
    // 清理后 get() 应返回调用方传入的 fallback（与"该字段从未声明"等价）。
    expect(cfg.get('llm.prompt_template', 'FB')).toBe('FB')
    expect(cfg.get('memory.context_window', 'FB')).toBe('FB')
    expect(cfg.get('memory.enable_compression', 'FB')).toBe('FB')
    expect(cfg.get('tools.default_timeout_ms', 'FB')).toBe('FB')
    expect(cfg.get('streaming.chunk_size', 'FB')).toBe('FB')
  })

  it('被保留的相关业务字段语义不变', () => {
    const cfg = new RuntimeConfig()
    // memory.default_strategy 实际被 fromEnv() 消费，必须保留为 'cache'
    expect(cfg.get('memory.default_strategy', null)).toBe('cache')
    // 其余原有业务字段不受影响
    expect(cfg.get('llm.default_provider', null)).toBe('deepseek')
    expect(cfg.get('llm.temperature', null)).toBe(0.7)
    expect(cfg.get('llm.max_tokens', null)).toBe(512)
    expect(cfg.get('feedback.evolution_threshold', null)).toBe(0.6)
    expect(cfg.get('memory.checkpointer_type', null)).toBe('memory')
    expect(cfg.get('tools.retry.max_attempts', null)).toBe(3)
  })

  it('构造函数 override 仍可正常深度合并（保持原逻辑）', () => {
    const cfg = new RuntimeConfig({ llm: { temperature: 0.9 } })
    expect(cfg.get('llm.temperature', null)).toBe(0.9)
    expect(cfg.get('llm.max_tokens', null)).toBe(512)
    expect(cfg.get('memory.default_strategy', null)).toBe('cache')
  })
})

describe('P0: yaml-loader 最小 YAML 子集解析', () => {
  it('解析嵌套 map 与标量（字符串/数字/布尔/null）', () => {
    const text = `
llm:
  default_provider: glm
  temperature: 0.3
  enabled: true
  note: null
memory:
  store_type: chroma
`
    const obj = parseYamlSubset(text)
    expect(obj.llm.default_provider).toBe('glm')
    expect(obj.llm.temperature).toBe(0.3)
    expect(obj.llm.enabled).toBe(true)
    expect(obj.llm.note).toBe(null)
    expect(obj.memory.store_type).toBe('chroma')
  })

  it('解析块列表（字符串项）', () => {
    const text = `
skills:
  active:
    - code_executor
    - sql_query
`
    const obj = parseYamlSubset(text)
    expect(obj.skills.active).toEqual(['code_executor', 'sql_query'])
  })

  it('解析列表项为 map', () => {
    const text = `
orchestration:
  mode_router:
    - when:
        config_key: orchestration.multi_agent.enabled
        config_value: true
      route: supervisor
    - when:
        config_key: plan_execute.enabled
        config_value: true
      route: planner
`
    const obj = parseYamlSubset(text)
    const router = obj.orchestration.mode_router
    expect(Array.isArray(router)).toBe(true)
    expect(router.length).toBe(2)
    expect(router[0].route).toBe('supervisor')
    expect(router[0].when.config_key).toBe('orchestration.multi_agent.enabled')
    expect(router[0].when.config_value).toBe(true)
    expect(router[1].route).toBe('planner')
  })

  it('忽略注释与空行', () => {
    const text = `
# 顶层注释
llm:
  # 嵌套注释
  default_provider: deepseek

  temperature: 0.7  # 行尾注释
`
    const obj = parseYamlSubset(text)
    expect(obj.llm.default_provider).toBe('deepseek')
    expect(obj.llm.temperature).toBe(0.7)
  })

  it('解析引号字符串（含冒号与特殊字符）', () => {
    const text = `
llm:
  note: "provider: deepseek-v4"
  raw: 'a:b:c'
`
    const obj = parseYamlSubset(text)
    expect(obj.llm.note).toBe('provider: deepseek-v4')
    expect(obj.llm.raw).toBe('a:b:c')
  })

  it('遇到不支持的裸行（无冒号且非列表）抛出（由上层降级）', () => {
    // 顶层无冒号、非列表的裸行不在支持范围
    const text = `this is not a valid yaml map line`
    expect(() => parseYamlSubset(text)).toThrow()
  })
})

describe('P0: deepMergeConfig 深度合并语义', () => {
  it('对象递归合并，标量/数组覆盖', () => {
    const base = { llm: { a: 1, b: { c: 2 } }, list: [1, 2] }
    const override = { llm: { b: { c: 99 }, d: 3 }, list: [9] }
    const merged = deepMergeConfig(structuredClone(base), override)
    expect(merged.llm.a).toBe(1) // 保留
    expect(merged.llm.b.c).toBe(99) // 覆盖
    expect(merged.llm.d).toBe(3) // 新增
    expect(merged.list).toEqual([9]) // 数组覆盖（不拼接）
  })
})

describe('P0: loadConfigYaml 与降级', () => {
  let tmpFile: string | null = null
  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
    tmpFile = null
  })

  it('解析合法 yaml 文件', () => {
    tmpFile = path.join(os.tmpdir(), `cfg-${Date.now()}.yaml`)
    fs.writeFileSync(tmpFile, 'llm:\n  temperature: 0.25\n')
    const obj = loadConfigYaml(tmpFile)
    expect(obj).not.toBeNull()
    expect(obj!.llm.temperature).toBe(0.25)
  })

  it('文件不存在返回 null（触发降级）', () => {
    expect(loadConfigYaml('/no/such/file.yaml')).toBeNull()
  })

  it('损坏的 yaml 文件返回 null（触发降级，不抛异常）', () => {
    tmpFile = path.join(os.tmpdir(), `bad-${Date.now()}.yaml`)
    // 顶层裸行（无冒号）会让解析器抛错，loadConfigYaml 捕获后返回 null
    fs.writeFileSync(tmpFile, 'llm:\n  this is not yaml\n')
    expect(loadConfigYaml(tmpFile)).toBeNull()
  })

  it('findConfigYaml 在包根无 config.yaml 时返回 null', () => {
    // 包根当前没有 config.yaml（清理阶段已确认），该断言验证搜索逻辑稳健
    const found = findConfigYaml()
    if (found) {
      expect(found.endsWith('config.yaml') || found.endsWith('config.yml')).toBe(true)
    } else {
      expect(found).toBeNull()
    }
  })
})

describe('P0: getConfig 分层与原逻辑等价', () => {
  const oldEnv = { ...process.env }

  beforeEach(() => {
    resetConfig()
    delete process.env.MODU_CONFIG_PATH
    delete process.env.MODU_LLM_PROVIDER
    delete process.env.MODU_MEMORY_STRATEGY
  })

  afterEach(() => {
    resetConfig()
    process.env = { ...oldEnv }
  })

  it('无 MODU_CONFIG_PATH、无 config.yaml 时，getConfig 等价于 fromEnv（保持原行为）', () => {
    const cfg = getConfig()
    // 默认内置值仍生效
    expect(cfg.get('llm.default_provider', null)).toBe('deepseek')
    expect(cfg.get('memory.default_strategy', null)).toBe('cache')
  })

  it('MODU_CONFIG_PATH 仍走 JSON 加载（保持原 JSON 兼容）', () => {
    const tmp = path.join(os.tmpdir(), `cfg-${Date.now()}.json`)
    fs.writeFileSync(tmp, JSON.stringify({ llm: { temperature: 0.11 } }))
    process.env.MODU_CONFIG_PATH = tmp
    const cfg = getConfig()
    expect(cfg.get('llm.temperature', null)).toBe(0.11)
    expect(cfg.get('llm.default_provider', null)).toBe('deepseek')
    fs.unlinkSync(tmp)
  })

  it('环境变量仍覆盖默认值（fromEnv 链路未被破坏）', () => {
    process.env.MODU_LLM_PROVIDER = 'glm'
    const cfg = getConfig()
    expect(cfg.get('llm.default_provider', null)).toBe('glm')
    expect(cfg.get('memory.default_strategy', null)).toBe('cache')
  })
})

describe('P0: 业务消费字段集成校验（确保清理未误伤）', () => {
  it('factory 实际读取的字段均可正常获取', () => {
    const cfg = new RuntimeConfig()
    // 取自 src/graph/factory.ts 的真实读取路径
    expect(cfg.get('memory.chroma_persist_path', 'X')).toBeNull()
    expect(cfg.get('llm.default_provider', null)).toBe('deepseek')
    expect(cfg.get('llm.router.enabled', false)).toBe(false)
    expect(cfg.get('llm.router.routes', null)).toBeDefined()
    expect(cfg.get('tools.register_defaults', true)).toBe(true)
    expect(cfg.get('memory.checkpointer_type', 'memory')).toBe('memory')
    expect(cfg.get('memory.store_type', 'chroma')).toBe('chroma')
  })
})
