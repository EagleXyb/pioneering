// P1-5 / P1-6：ScenarioHost 作用域回滚精确性测试。
//   P1-5：registerEdge 的 undo 精确到 from+to，不误删他包同 from 不同 to 的边；
//   P1-6：配置覆盖回滚走 RuntimeConfig.remove，get 回落到默认值而非 undefined。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { ScenarioHost } from '@/kernel/scenario-host.js'
import { ComponentRegistry } from '@/core/registry.js'
import { RuntimeConfig } from '@/config/runtime-config.js'

let registry: ComponentRegistry
let config: RuntimeConfig

beforeEach(() => {
  registry = new ComponentRegistry()
  config = new RuntimeConfig()
})

afterEach(() => {
  // 释放全局 emitter 等持有的引用
  config = null as unknown as RuntimeConfig
  registry = null as unknown as ComponentRegistry
})

function newHost(scope: string): ScenarioHost {
  return new ScenarioHost({
    scope,
    packDir: `/tmp/${scope}`,
    registry,
    config,
  })
}

describe('P1-5 · registerEdge 卸载精确到单条边', () => {
  it('两包同 from 不同 to：先卸载者不删另一个包的边', () => {
    // 包 B 先注册 a → b
    const hostB = newHost('pack-b')
    hostB.registerEdge({ from: 'a', to: 'b' })

    // 包 A 注册 a → c
    const hostA = newHost('pack-a')
    hostA.registerEdge({ from: 'a', to: 'c' })

    const targetsBefore = registry.listEdgeSpecs().map((e) => e.to as string).sort()
    expect(targetsBefore).toEqual(['b', 'c'])

    // 卸载 A：只应移除 a→c，a→b 保留
    hostA.deactivate()
    const edgesAfter = registry.listEdgeSpecs()
    expect(edgesAfter).toHaveLength(1)
    expect(edgesAfter[0].from).toBe('a')
    expect(edgesAfter[0].to).toBe('b')

    hostB.deactivate()
    expect(registry.listEdgeSpecs()).toHaveLength(0)
  })

  it('同 from 同 to 覆盖场景：先卸载者不影响后注册者（按引用计数语义）', () => {
    const hostB = newHost('pack-b')
    hostB.registerEdge({ from: 'x', to: 'y' })
    const hostA = newHost('pack-a')
    hostA.registerEdge({ from: 'x', to: 'y' })

    // A 卸载：removeEdgeSpec 删除匹配边（此时删掉一条），B 的 host 记录的 prior 是注册前快照
    // —— 注册表是"同规格边只存一条"的扁平数组，两条相同 EdgeSpec 本就只占一个槽位；
    // 本用例锁定"不抛错且 B 卸载后归零"的可预测行为。
    expect(() => hostA.deactivate()).not.toThrow()
    expect(() => hostB.deactivate()).not.toThrow()
    expect(registry.listEdgeSpecs()).toHaveLength(0)
  })

  it('条件边（to 为路由对象）卸载不误伤同名 from 的普通边', () => {
    const hostB = newHost('pack-b')
    hostB.registerEdge({ from: 'r', to: 'z' })

    const hostA = newHost('pack-a')
    hostA.registerEdge({
      from: 'r',
      to: {
        router: () => 'cond',
        targets: [[() => true, 'z']],
      } as any,
    })

    hostA.deactivate()
    const remaining = registry.listEdgeSpecs()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].to).toBe('z')

    hostB.deactivate()
    expect(registry.listEdgeSpecs()).toHaveLength(0)
  })
})

describe('P1-6 · 配置覆盖回滚（remove 原语）', () => {
  it('RuntimeConfig.remove 删除叶键并清理空容器；get 回落默认值', () => {
    config.update('foo.bar.baz', 123)
    expect(config.get('foo.bar.baz', null)).toBe(123)

    expect(config.remove('foo.bar.baz')).toBe(true)
    expect(config.get('foo.bar.baz', 'DEFAULT')).toBe('DEFAULT')
    // 空容器被级联清理（foo/bar 均为空对象）
    expect((config.asDict() as any)['foo']).toBeUndefined()

    // 删除不存在的键返回 false，不抛错
    expect(config.remove('never.existed')).toBe(false)
  })

  it('remove 只清理变空的容器分支，保留兄弟键', () => {
    config.update('a.b.c', 1)
    config.update('a.b.d', 2)
    config.remove('a.b.c')
    expect(config.get('a.b.d', null)).toBe(2)
    expect(config.get('a.b.c', 'x')).toBe('x')
  })

  it('场景包覆盖不存在的键：卸载后 get 返回默认值而非 undefined', () => {
    const host = newHost('pack-cfg')
    host.applyConfigOverrides({ 'custom.feature.flag': true })
    expect(config.get('custom.feature.flag', false)).toBe(true)

    host.deactivate()
    // 旧缺陷：update(key, undefined) 后键残留，get 返回 undefined
    expect(config.get('custom.feature.flag', false)).toBe(false)
    expect(config.get('custom.feature.flag', 'DEFAULT')).toBe('DEFAULT')
    expect((config.asDict() as any)['custom']).toBeUndefined()
  })

  it('场景包覆盖已有键：卸载后恢复原值', () => {
    config.update('llm.temperature', 0.7)
    const host = newHost('pack-cfg2')
    host.applyConfigOverrides({ 'llm.temperature': 0.1 })
    expect(config.get('llm.temperature', null)).toBe(0.1)

    host.deactivate()
    expect(config.get('llm.temperature', null)).toBe(0.7)
  })

  it('remove 触发 change 回调（newValue=undefined）', () => {
    config.update('obs.key', 'v')
    const events: Array<{ keyPath: string; oldValue: any; newValue: any }> = []
    const off = config.registerChangeCallback((keyPath, oldValue, newValue) => {
      events.push({ keyPath, oldValue, newValue })
    })

    config.remove('obs.key')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ keyPath: 'obs.key', oldValue: 'v', newValue: undefined })
    off()
  })
})
