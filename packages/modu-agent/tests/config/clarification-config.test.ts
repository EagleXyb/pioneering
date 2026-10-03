// 澄清灰度配置解析测试（阶段2）
//
// 锁定两件事：
//   1. DEFAULT_CONFIG 提供澄清独立超时默认值（库默认关闭，零侵入）
//   2. 仓库 config.yaml 的 clarification 段可被 parseYamlSubset 正确解析、
//      类型校验不丢弃任何键——灰度参数必须真实生效，而不是静默回退默认值
//      （YAML 写错类型时 loadConfigYamlValidated 会丢弃该键，表现为"开了等于没开"）

import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from '@/config/runtime-config.js'
import { deepMergeConfig, findConfigYaml, loadConfigYamlValidated } from '@/config/yaml-loader.js'

describe('需求澄清灰度配置（阶段2）', () => {
  it('DEFAULT_CONFIG：澄清默认关闭 + 独立超时默认值', () => {
    const c = (DEFAULT_CONFIG as Record<string, any>).perception.clarification
    expect(c.enabled).toBe(false)
    expect(c.timeout_seconds).toBe(120)
    expect(c.on_timeout).toBe('continue_with_defaults')
  })

  it('仓库 config.yaml 的 clarification 段解析正确且类型校验无丢弃（灰度生效）', () => {
    expect(findConfigYaml()).not.toBeNull()
    const res = loadConfigYamlValidated(DEFAULT_CONFIG)
    expect(res).not.toBeNull()

    // 类型不符的键会被丢弃 → 灰度参数若写错类型将静默失效，此处显式断言无丢弃
    const dropped: string[] = Array.isArray(res!.droppedKeys) ? (res!.droppedKeys as string[]) : []
    expect(dropped.filter((k) => k.includes('clarification'))).toEqual([])

    // deepMergeConfig 原地合并 base：深拷贝 DEFAULT_CONFIG，避免污染其他测试
    const merged = deepMergeConfig(
      JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, any>,
      res!.cleaned,
    )
    const c = (merged as Record<string, any>).perception.clarification
    expect(c.enabled).toBe(true)
    expect(c.max_clarify_rounds).toBe(1)
    expect(c.min_input_chars).toBe(3)
    expect(c.timeout_seconds).toBe(120)
    expect(c.on_timeout).toBe('continue_with_defaults')
    expect(Array.isArray(c.insufficient_patterns)).toBe(true)
    expect(c.insufficient_patterns).toContain('帮我弄一下')
  })
})
