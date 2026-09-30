// P1-15：delegation 步骤仅在 supervisor 子图实际挂载时才路由，否则降级 agent。
import { describe, it, expect, afterEach } from 'vitest'

import { stepDispatch } from '@/graph/plan-execute/dispatcher.js'
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

  it('多步就绪且 supervisor 关闭：delegation 与普通步骤全部走 agent（混合并行不炸图）', () => {
    getConfig().update('orchestration.multi_agent.enabled', false)
    const plan = [
      pendingStep({ task_type: 'delegation', step_id: 'd1' }),
      pendingStep({ task_type: 'tool_use', step_id: 't1' }),
    ]
    const result = stepDispatch(stateWith(plan))
    expect(sendTargets(result).sort()).toEqual(['agent', 'agent'])
  })

  it('多步就绪且 supervisor 开启：delegation 走 supervisor，其余走 agent', () => {
    getConfig().update('orchestration.multi_agent.enabled', true)
    const plan = [
      pendingStep({ task_type: 'delegation', step_id: 'd1' }),
      pendingStep({ task_type: 'reasoning', step_id: 'r1' }),
    ]
    const result = sendTargets(stepDispatch(stateWith(plan))).sort()
    expect(result).toEqual(['agent', 'supervisor'])
  })

  it('无 task_type 的普通就绪步骤行为不回归（agent）', () => {
    getConfig().update('orchestration.multi_agent.enabled', false)
    expect(sendTargets(stepDispatch(stateWith([pendingStep({})])))).toEqual(['agent'])
  })
})
