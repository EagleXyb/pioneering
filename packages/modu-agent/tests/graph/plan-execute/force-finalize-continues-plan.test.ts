// P0-2 回归测试（2026-10-14）：
//
// 缺陷（实测复现，会话 sess_d7185e5c…）：7 步计划的任务，第 1 步工具调用轮次用尽
// 后，routeAfterAgent 路由到 force_finalize，而 graph.ts 是静态边
// `force_finalize → finalize_response` —— 直接终结整轮：
//   · step_finalize 从未执行（DB 中 step_1 恒为 running）
//   · step_2~step_7 从未执行（恒为 pending），用户无任何提示
//
// 根因链：
//   1. force_finalize 出边无条件指向 finalize_response（不区分是否在计划执行中）
//   2. reasoning_round_count 为全 run 累加 reducer 且**从不重置**，
//      因此即使修好 1，后续每一步一进 agent 就会再次"触顶"
//
// 修复：
//   1. plan_execute 下触顶返回 'plan_force_finalize'（仍进 force_finalize 收尾作答），
//      该节点出边改为条件路由 routeAfterForceFinalize：plan 中 → step_finalize
//   2. 新增逐步骤计数器 step_round_count（last-write-wins）：
//      agentNode「读旧值 +1」写入，step_finalize 归零
import { describe, it, expect, afterEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'

import { routeAfterAgent, routeAfterForceFinalize } from '@/graph/nodes.js'
import { makeStepFinalizeNode } from '@/graph/plan-execute/dispatcher.js'
import { getConfig, resetConfig } from '@/config/runtime-config.js'
import type { ModuAgentState } from '@/graph/state.js'

function planState(over: Record<string, any> = {}): ModuAgentState {
  const plan = [
    { step_id: 'step_1', title: 'A', status: 'running', description: 'do A' },
    { step_id: 'step_2', title: 'B', status: 'pending', description: 'do B' },
  ]
  return {
    plan,
    current_step_index: 0,
    current_step: { ...plan[0] },
    step_msg_baseline: 0,
    tool_results: [{ status: 'success', tool: 'search_engine' }],
    ...over,
  } as unknown as ModuAgentState
}

/** 末尾为「带 tool_calls 的 AIMessage」的消息列表（触发 routeAfterAgent 的触顶判定分支） */
function msgsWithToolCalls(): AIMessage[] {
  return [
    new AIMessage({
      content: '我去检索一下',
      tool_calls: [{ id: 'call_1', name: 'search_engine', args: { q: 'x' } } as any],
    }),
  ]
}

describe('P0-2 · 预算触顶后计划继续执行', () => {
  afterEach(() => {
    resetConfig()
  })

  it('触顶（plan 模式）→ plan_force_finalize，而非直接终结计划的 force_finalize', () => {
    const state = planState({
      messages: msgsWithToolCalls(),
      plan_phase: 'executing',
      step_round_count: 6,
      reasoning_round_count: 0,
      complexity_assessment: null,
    })
    expect(routeAfterAgent(state)).toBe('plan_force_finalize')
  })

  it('force_finalize 收尾后（plan 模式）回到 step_finalize 继续跑后续步骤', () => {
    const state = planState({ messages: [], plan_phase: 'executing' })
    expect(routeAfterForceFinalize(state)).toBe('step_finalize')
  })

  it('force_finalize 收尾后（ReAct 模式）行为不变：进 finalize_response', () => {
    const state = planState({ messages: [], plan_phase: '' })
    expect(routeAfterForceFinalize(state)).toBe('finalize_response')
  })

  it('回归：plan 模式下 step_round_count 未触顶 → 正常继续 tools 分支', () => {
    const state = planState({
      messages: msgsWithToolCalls(),
      plan_phase: 'executing',
      step_round_count: 1,
      reasoning_round_count: 0,
      complexity_assessment: null,
    })
    expect(routeAfterAgent(state)).toBe('tools')
  })

  it('回归：plan 模式下旧的 reasoning_round_count 已很大但本步未耗预算 → 不触顶', () => {
    // 修复前用 reasoning_round_count 判定，这里会误判触顶（后续步骤无法执行）
    const state = planState({
      messages: msgsWithToolCalls(),
      plan_phase: 'executing',
      step_round_count: 0,
      reasoning_round_count: 20,
      complexity_assessment: null,
    })
    expect(routeAfterAgent(state)).toBe('tools')
  })

  it('行为不回归：ReAct 模式仍按 reasoning_round_count 触顶 → force_finalize', () => {
    const state = planState({
      messages: msgsWithToolCalls(),
      plan_phase: '',
      reasoning_round_count: 6,
      step_round_count: 0,
      complexity_assessment: null,
    })
    expect(routeAfterAgent(state)).toBe('force_finalize')
  })

  it('complexity_assessment 的 reasoning_budget 在 plan 模式下同样按本步计数', () => {
    const state = planState({
      messages: msgsWithToolCalls(),
      plan_phase: 'executing',
      step_round_count: 2,
      reasoning_round_count: 0,
      complexity_assessment: { reasoning_budget: 2, tier: 'simple' },
    })
    expect(routeAfterAgent(state)).toBe('plan_force_finalize')
  })

  it('step_finalize 完成后把 step_round_count 归零（否则后续步骤一进 agent 就触顶）', async () => {
    const state = planState({
      messages: [new AIMessage({ content: '本步已完成，结论如下…' })],
      plan_phase: 'executing',
      step_round_count: 6,
    })
    const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
    expect(updates.step_round_count).toBe(0)
    expect(String(updates.plan?.[0]?.['status'])).toBe('done')
  })

  it('步骤重试分支同样把 step_round_count 归零（重试不该继承已耗尽预算）', async () => {
    getConfig().update('plan_execute.step_retry.default_max_attempts', 2)
    const state = planState({
      messages: [],
      plan_phase: 'executing',
      step_round_count: 6,
    })
    const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
    // 无输出 → failed → 触发重试分支
    expect(updates.plan_delta?.step_update?.status).toBe('retrying')
    expect(updates.step_round_count).toBe(0)
  })

  it('step_finalize 清除 forced_finalize 标记，避免泄漏到后续步骤', async () => {
    const state = planState({
      messages: [new AIMessage({ content: '收尾作答内容' })],
      plan_phase: 'executing',
      forced_finalize: true,
      step_round_count: 6,
    })
    const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
    expect(updates.forced_finalize).toBe(false)
  })
})
