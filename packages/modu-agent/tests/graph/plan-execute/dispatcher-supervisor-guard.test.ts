// P1-15：delegation 步骤仅在 supervisor 子图实际挂载时才路由，否则降级 agent。
import { describe, it, expect, afterEach } from 'vitest'

import { makeStepDispatchNode, stepDispatch } from '@/graph/plan-execute/dispatcher.js'
import { getConfig, resetConfig } from '@/config/runtime-config.js'
import type { ModuAgentState } from '@/graph/state.js'

function stateWith(plan: Array<Record<string, any>>, idx = 0): ModuAgentState {
  return { plan, current_step_index: idx, messages: [] } as unknown as ModuAgentState
}

function pendingStep(over: Record<string, any>): Record<string, any> {
  return { status: 'pending', step_id: `s_${Math.random().toString(36).slice(2)}`, depends_on: [], ...over }
}

function sendTargets(result: string | any[]): string[] {
  if (typeof result === 'string') return [result]
  return (result as any[]).map((s) => s.node)
}

describe('P1-15 · stepDispatch delegation 需 supervisor 已挂载', () => {
  afterEach(() => {
    resetConfig()
  })

  it('multi_agent.enabled=false：单 delegation 步骤降级为 agent（不 Send supervisor）', () => {
    getConfig().update('orchestration.multi_agent.enabled', false)
    const result = stepDispatch(stateWith([pendingStep({ task_type: 'delegation' })]))
    expect(sendTargets(result)).toEqual(['agent'])
  })

  it('multi_agent.enabled=true：单 delegation 步骤 Send 到 supervisor', () => {
    getConfig().update('orchestration.multi_agent.enabled', true)
    const result = stepDispatch(stateWith([pendingStep({ task_type: 'delegation', step_id: 'd1' })]))
    expect(Array.isArray(result)).toBe(true)
    expect(sendTargets(result)).toEqual(['supervisor'])
  })

  it('多步就绪：先 Send step_dispatch 补 running 事件；supervisor 关闭时激活后降级 agent', () => {
    getConfig().update('orchestration.multi_agent.enabled', false)
    const plan = [
      pendingStep({ task_type: 'delegation', step_id: 'd1' }),
      pendingStep({ task_type: 'tool_use', step_id: 't1' }),
    ]
    // P1-2：多步就绪首跳统一进 step_dispatch 节点（由其标记 running 并发事件）
    // P2-1：真并行暂未启用（plan 为 last-write-wins，多分支整表替换会互相覆盖），
    // 改为按就绪顺序逐个派发，因此期望单个 Send。
    const result = stepDispatch(stateWith(plan))
    expect(sendTargets(result).sort()).toEqual(['step_dispatch'])

    // 节点激活 d1（idx=0）后路由：supervisor 未启用 → 降级 agent
    const branchState = stateWith(plan, 0)
    const merged = { ...branchState, ...makeStepDispatchNode()(branchState) } as ModuAgentState
    expect(sendTargets(stepDispatch(merged))).toEqual(['agent'])
  })

  it('多步就绪且 supervisor 开启：首跳 step_dispatch，激活后 delegation 走 supervisor、其余走 agent', () => {
    getConfig().update('orchestration.multi_agent.enabled', true)
    const plan = [
      pendingStep({ task_type: 'delegation', step_id: 'd1' }),
      pendingStep({ task_type: 'reasoning', step_id: 'r1' }),
    ]
    // P2-1：逐个派发 → 单个 Send
    expect(sendTargets(stepDispatch(stateWith(plan))).sort()).toEqual([
      'step_dispatch',
    ])

    // 激活 d1（idx=0）→ Send supervisor
    const branch1 = stateWith(plan, 0)
    const merged1 = { ...branch1, ...makeStepDispatchNode()(branch1) } as ModuAgentState
    expect(sendTargets(stepDispatch(merged1))).toEqual(['supervisor'])

    // 激活 r1（idx=1）→ agent
    const branch2 = stateWith(plan, 1)
    const merged2 = { ...branch2, ...makeStepDispatchNode()(branch2) } as ModuAgentState
    expect(sendTargets(stepDispatch(merged2))).toEqual(['agent'])
  })

  it('无 task_type 的普通就绪步骤行为不回归（agent）', () => {
    getConfig().update('orchestration.multi_agent.enabled', false)
    expect(sendTargets(stepDispatch(stateWith([pendingStep({})])))).toEqual(['agent'])
  })
})
