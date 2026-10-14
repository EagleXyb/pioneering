// P0 回归测试（2026-10-14）：
// 缺陷：含 depends_on 的计划在 step_dispatch 节点激活当前步（pending→running）后，
//      stepDispatch 路由把当前步排除出就绪集合，其下游步骤因依赖未满足同样不就绪，
//      被误判 "No ready steps" 而静默终止（前端显示"已完成 0/N"的假成功）。
// 修复：路由识别"已激活（running）的当前步"直接派发 agent；确无可执行步骤时抛错，
//      让上游发出 RUN_ERROR（前端显示"失败"），而非静默按成功收尾。
import { describe, it, expect, afterEach } from 'vitest'

import { makeStepDispatchNode, stepDispatch } from '@/graph/plan-execute/dispatcher.js'
import { getConfig, resetConfig } from '@/config/runtime-config.js'
import type { ModuAgentState } from '@/graph/state.js'

function stateWith(plan: Array<Record<string, any>>, idx = 0): ModuAgentState {
  return { plan, current_step_index: idx, messages: [] } as unknown as ModuAgentState
}

/** 复刻线上真实计划：star + chain 依赖（7 步，全 pending） */
function screenshotPlan(): Array<Record<string, any>> {
  return [
    { step_id: 'step_1', title: '梳理知识框架与输出大纲', status: 'pending' },
    { step_id: 'step_2', title: '撰写基础提示技术章节', status: 'pending', depends_on: ['step_1'] },
    { step_id: 'step_3', title: '撰写上下文窗口管理四策略章节', status: 'pending', depends_on: ['step_1'] },
    { step_id: 'step_4', title: '撰写提示词版本管理章节', status: 'pending', depends_on: ['step_1'] },
    { step_id: 'step_5', title: '撰写跨模型Prompt适配章节', status: 'pending', depends_on: ['step_1'] },
    {
      step_id: 'step_6',
      title: '整合内容并生成Markdown文档',
      status: 'pending',
      depends_on: ['step_2', 'step_3', 'step_4', 'step_5'],
    },
    { step_id: 'step_7', title: '校验文档完整性与结构', status: 'pending', depends_on: ['step_6'] },
  ]
}

describe('P0 · stepDispatch 激活步派发 / 终止语义', () => {
  afterEach(() => {
    resetConfig()
  })

  it('回归：含依赖计划首步被节点激活（running）后，路由派发 agent 而非静默终止', () => {
    const state = stateWith(screenshotPlan(), 0)
    // LangGraph 执行顺序：step_dispatch 节点 → stepDispatch 条件边
    const updates = makeStepDispatchNode()(state)
    const merged = { ...state, ...updates } as ModuAgentState
    expect(String(merged.plan?.[0]?.['status'])).toBe('running')

    expect(stepDispatch(merged)).toBe('agent')
  })

  it('回归：前序步骤完成后（step_3 激活）同样派发 agent', () => {
    const plan = screenshotPlan()
    plan[0]['status'] = 'done'
    plan[1]['status'] = 'done'
    const state = stateWith(plan, 2)
    const updates = makeStepDispatchNode()(state)
    const merged = { ...state, ...updates } as ModuAgentState
    expect(String(merged.plan?.[2]?.['status'])).toBe('running')

    expect(stepDispatch(merged)).toBe('agent')
  })

  it('无依赖计划首步激活后派发 agent（旧实现会排除当前步）', () => {
    const plan = [
      { step_id: 'step_1', status: 'pending' },
      { step_id: 'step_2', status: 'pending' },
    ]
    const state = stateWith(plan, 0)
    const merged = { ...state, ...makeStepDispatchNode()(state) } as ModuAgentState
    expect(stepDispatch(merged)).toBe('agent')
  })

  it('没有任何可执行步骤时抛错（不再静默 return response 造成假成功）', () => {
    const plan = [
      { step_id: 'step_1', status: 'done' },
      { step_id: 'step_2', status: 'pending', depends_on: ['not_exists'] },
    ]
    expect(() => stepDispatch(stateWith(plan, 0))).toThrow(/no executable steps/i)
  })

  it('全部步骤终态（done/skipped）→ response，行为不回归', () => {
    const plan = [
      { step_id: 'step_1', status: 'done' },
      { step_id: 'step_2', status: 'skipped' },
    ]
    expect(stepDispatch(stateWith(plan, 0))).toBe('response')
  })

  it('当前步仍为 pending（未经过节点）时保持既有兜底派发行为', () => {
    const plan = [{ step_id: 'step_1', status: 'pending' }]
    expect(stepDispatch(stateWith(plan, 0))).toBe('agent')
  })

  it('激活的 delegation 步骤（supervisor 已启用）→ Send supervisor 而非 agent', () => {
    getConfig().update('orchestration.multi_agent.enabled', true)
    const plan = [
      { step_id: 'd1', title: '委托步骤', status: 'running', task_type: 'delegation' },
    ]
    const result = stepDispatch(stateWith(plan, 0))
    expect(Array.isArray(result)).toBe(true)
    expect((result as any[]).map((s) => s.node)).toEqual(['supervisor'])
  })

  it('激活的 delegation 步骤（supervisor 未启用）→ 降级 agent（P1-15 守卫）', () => {
    getConfig().update('orchestration.multi_agent.enabled', false)
    const plan = [
      { step_id: 'd1', title: '委托步骤', status: 'running', task_type: 'delegation' },
    ]
    expect(stepDispatch(stateWith(plan, 0))).toBe('agent')
  })

  it('P1-2 / P2-1：多步就绪经 step_dispatch 激活并下发 running 事件（payload 带全量状态）', () => {
    const plan = [
      { step_id: 'step_1', title: 'A', status: 'pending' },
      { step_id: 'step_2', title: 'B', status: 'pending' },
    ]

    // 多步就绪 → 经 step_dispatch 激活（P2-1：真并行暂未启用，按就绪顺序逐个派发）
    const result = stepDispatch(stateWith(plan, 0))
    expect((result as any[]).map((s) => s.node)).toEqual(['step_dispatch'])

    // P2-1 核心回归：Send 的 args 就是目标节点的唯一输入（不会与 channel 合并），
    // 因此必须带 plan 等字段；否则节点读不到 plan → return {} → 路由空转至递归上限。
    const payload = (result as any[])[0].args as Record<string, any>
    expect(payload.plan).toBeTruthy()
    expect(payload.current_step_index).toBe(0)
    expect(payload.current_step?.status).toBe('running')
    expect(payload.plan_phase).toBe('executing')

    // 节点拿到 payload 后能正常标记 running（此前 state.plan 为 undefined 会直接 return {}）
    const nodeUpdates = makeStepDispatchNode()(payload as unknown as ModuAgentState) as Record<string, any>
    expect(nodeUpdates.plan?.[0]?.['status']).toBe('running')
    expect(nodeUpdates.plan_delta?.step_update?.status).toBe('running')

    // 每个分支的节点执行都产生 running 的 step_update（含 started_at）
    for (const idx of [0, 1]) {
      const branch = stateWith(plan, idx)
      const updates = makeStepDispatchNode()(branch) as Record<string, any>
      expect(updates.plan_delta?.step_update).toMatchObject({
        id: `step_${idx + 1}`,
        status: 'running',
      })
      expect(typeof updates.plan_delta?.step_update?.started_at).toBe('number')
    }
  })
})
