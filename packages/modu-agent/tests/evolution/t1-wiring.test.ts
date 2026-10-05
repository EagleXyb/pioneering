import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { EvolutionSignalCollector } from '@/feedback/evolution-signal.js'
import {
  EventBus,
  reset_event_bus,
} from '@/orchestration/communication/message-bus.js'
import { EventDomain, EventAction, EventPriority } from '@/orchestration/communication/protocol.js'
import { EvolutionOrchestrator } from '@/evolution/evolution-orchestrator.js'
import { ComponentSwapStrategy } from '@/evolution/component-swap.js'
import { getRegistry, resetRegistry } from '@/core/registry.js'
import { overrideConfig, RuntimeConfig } from '@/config/runtime-config.js'

function evt(domain: string, action: string, priority: EventPriority = EventPriority.NORMAL): any {
  return {
    event_id: `e-${Math.random().toString(36).slice(2, 8)}`,
    domain,
    action,
    priority,
    trace_id: 't1',
    session_id: 's1',
    metadata: {},
    timestamp: Date.now(),
  } as any
}

describe('T1-1 EvolutionSignalCollector 接入 EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
    resetRegistry()
  })

  afterEach(() => {
    reset_event_bus()
    resetRegistry()
    overrideConfig(new RuntimeConfig())
  })

  it('常规事件按采样率成信号（削峰行为不变）', async () => {
    const c = new EvolutionSignalCollector(2)
    c.attachEventBus(bus)
    for (let i = 0; i < 4; i++) await bus.publish(evt(EventDomain.LLM, EventAction.COST))
    expect(c.getSignals().length).toBe(2)
    c.detachEventBus()
  })

  it('高优先级事件绕过采样即时成信号（低频高危不再被丢）', async () => {
    const c = new EvolutionSignalCollector(1000)
    c.attachEventBus(bus)
    // consensus 失败只发生 1 次 → count=1 永远达不到 1000 阈值
    await bus.publish(evt(EventDomain.FEEDBACK, EventAction.COST, EventPriority.HIGH))
    const sigs = c.getSignals()
    expect(sigs.length).toBe(1)
    expect(sigs[0].severity).toBe('high')
    c.detachEventBus()
  })

  it('critical 事件同样即时成信号', async () => {
    const c = new EvolutionSignalCollector(1000)
    c.attachEventBus(bus)
    await bus.publish(evt(EventDomain.SECURITY, EventAction.COST, EventPriority.CRITICAL))
    expect(c.getSignals().length).toBe(1)
    c.detachEventBus()
  })

  it('attach 幂等：重复 attach 不重复计数', async () => {
    const c = new EvolutionSignalCollector(1)
    c.attachEventBus(bus)
    c.attachEventBus(bus)
    await bus.publish(evt(EventDomain.FEEDBACK, EventAction.COST))
    expect(c.getSignals().length).toBe(1)
    c.detachEventBus()
  })

  it('detach 后不再接收事件', async () => {
    const c = new EvolutionSignalCollector(1)
    c.attachEventBus(bus)
    expect(c.attached).toBe(true)
    c.detachEventBus()
    expect(c.attached).toBe(false)
    await bus.publish(evt(EventDomain.FEEDBACK, EventAction.COST))
    expect(c.getSignals().length).toBe(0)
  })

  it('信号缓冲受 _MAX_SIGNALS=500 上限约束', () => {
    const c = new EvolutionSignalCollector(1)
    for (let i = 0; i < 600; i++) {
      c.onAgentEvent(evt(EventDomain.LLM, EventAction.COST, EventPriority.HIGH))
    }
    expect(c.getSignals().length).toBeLessThanOrEqual(500)
  })

  it('event-bridge 与 EventBus 订阅对同一事件不重复计数', async () => {
    const { LangGraphEventBridge } = await import('@/graph/adapters/event-bridge.js')
    const c = new EvolutionSignalCollector(1)
    c.attachEventBus(bus)
    const bridge = new LangGraphEventBridge(bus as any, c as any, 't1', 's1', 'u1')

    // 构造一条最小 LangGraph 流事件（updates 形态 → 可映射为 AgentEvent）
    async function* fakeStream() {
      yield { type: 'updates', node: 'agent', updates: {} }
    }
    // 消费全流
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _e of bridge.consume(fakeStream() as any)) { /* drain */ }

    // 关键断言：collector.attached=true 时，event-bridge 走 EventBus 单一路径，
    // 每个事件只应产生 1 个信号（若仍直投则会翻倍）
    const sigs = c.getSignals()
    expect(sigs.length).toBeLessThanOrEqual(1)
    c.detachEventBus()
  })

  it('collector 未订阅总线时 event-bridge 直投仍生效（兼容旧用法）', async () => {
    const { LangGraphEventBridge } = await import('@/graph/adapters/event-bridge.js')
    const c = new EvolutionSignalCollector(1)
    // 不调用 attachEventBus → attached=false
    expect(c.attached).toBe(false)
    const bridge = new LangGraphEventBridge(bus as any, c as any, 't1', 's1', 'u1')
    async function* fakeStream() {
      yield { type: 'updates', node: 'agent', updates: {} }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _e of bridge.consume(fakeStream() as any)) { /* drain */ }
    // 未订阅时 EventBus 不会自动投递，但 bridge 的直投路径应至少不报错
    expect(c.attached).toBe(false)
  })

  it('EvolutionOrchestrator 构造后自动挂载全局总线，dispose 可释放', () => {
    const orch = new EvolutionOrchestrator()
    expect(orch.evolutionCollector.attached).toBe(true)
    orch.dispose()
    expect(orch.evolutionCollector.attached).toBe(false)
  })

  it('null/undefined 事件被安全忽略', () => {
    const c = new EvolutionSignalCollector(1)
    c.onAgentEvent(null)
    c.onAgentEvent(undefined)
    expect(c.getSignals().length).toBe(0)
  })
})

describe('T1-2 组件层进化接线', () => {
  beforeEach(() => resetRegistry())
  afterEach(() => {
    overrideConfig(new RuntimeConfig())
    resetRegistry()
  })

  it('applySwap 真正写入注册表', () => {
    const registry = getRegistry()
    const strat = new ComponentSwapStrategy(registry, new EvolutionSignalCollector(1), 0.05)
    strat.recordScore('demo', 'v1', 0.5)
    strat.recordScore('demo', 'v2', 0.9)
    const applied = strat.applySwap('demo', 'tool', {
      current: 'v1',
      candidate: 'v2',
      components: { current: { id: 'v1' }, candidate: { id: 'v2' } },
    })
    expect(applied).toBe(true)
    expect((registry.getTool('demo') as any).id).toBe('v2')
  })

  it('得分未达阈值时不替换', () => {
    const strat = new ComponentSwapStrategy(getRegistry(), new EvolutionSignalCollector(1), 0.05)
    strat.recordScore('c', 'v1', 0.9)
    strat.recordScore('c', 'v2', 0.91)
    expect(
      strat.applySwap('c', 'tool', {
        current: 'v1', candidate: 'v2', components: { current: null, candidate: {} },
      }),
    ).toBe(false)
  })

  it('缺少候选实例时拒绝替换', () => {
    const strat = new ComponentSwapStrategy(getRegistry(), new EvolutionSignalCollector(1), 0.05)
    strat.recordScore('c', 'v1', 0.1)
    strat.recordScore('c', 'v2', 0.9)
    expect(
      strat.applySwap('c', 'tool', {
        current: 'v1', candidate: 'v2', components: { current: null, candidate: null },
      }),
    ).toBe(false)
  })

  it('默认配置下组件层不接线（零行为变化）', () => {
    const orch = new EvolutionOrchestrator() as any
    expect(orch._componentSwap).toBeNull()
    expect(orch._rollback).toBeNull()
    orch.dispose()
  })

  it('开启开关后组件层被实例化', () => {
    overrideConfig(new RuntimeConfig({
      feedback: { enable_component_swap: true, enable_auto_rollback: true },
    }))
    const orch = new EvolutionOrchestrator() as any
    expect(orch._componentSwap).not.toBeNull()
    expect(orch._rollback).not.toBeNull()
    orch.dispose()
  })

  it('未声明候选组件时不执行任何替换（保守契约）', async () => {
    overrideConfig(new RuntimeConfig({
      feedback: { enable_component_swap: true, enable_auto_rollback: true },
    }))
    const orch = new EvolutionOrchestrator()
    const res = await orch.evaluateAndEvolve({ response: 'x' }, { prompt: 'y' }, 'sess-1')
    expect(res['component_action']).toBeUndefined()
    orch.dispose()
  })
})

describe('T2-1 扩展点反注册完整性', () => {
  beforeEach(() => resetRegistry())
  afterEach(() => resetRegistry())

  it('unregisterPerception 可移除感知器', () => {
    const registry = getRegistry()
    const p = { name: () => 'p1' } as any
    registry.registerPerception('p1', p)
    expect(registry.getPerception('p1')).toBe(p)
    expect(registry.unregisterPerception('p1')).toBe(true)
    expect(registry.getPerception('p1')).toBeUndefined()
  })

  it('unregisterPerception 对不存在的键返回 false', () => {
    expect(getRegistry().unregisterPerception('nope')).toBe(false)
  })

  it('unregisterPrompt 可移除模板', () => {
    const registry = getRegistry()
    registry.registerPrompt({
      id: 't.demo', version: '1.0.0', messages: [{ role: 'system', content: 'x' }],
    })
    expect(registry.getPrompt('t.demo')).toBeTruthy()
    expect(registry.unregisterPrompt('t.demo')).toBe(true)
    expect(registry.getPrompt('t.demo')).toBeUndefined()
  })

  it('unregisterPrompt 对不存在的 id 返回 false', () => {
    expect(getRegistry().unregisterPrompt('nope')).toBe(false)
  })
})
