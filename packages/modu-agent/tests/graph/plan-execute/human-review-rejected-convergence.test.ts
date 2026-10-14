// P0 回归测试（2026-10-14）：审批被拒/超时后计划必须完整收敛
//
// 缺陷（实测）：plan_execute 任务在执行中途调用恒需审批的工具（如第 8 步
// doc_writer 写报告）→ 用户拒绝（或 300s 超时自动拒绝）→ human_review 原实现
// 无条件路由到 finalize_response 终结整轮：
//   · step_finalize 从未执行（DB / 前端 step_8 恒为 running）
//   · 剩余步骤（step_9）恒为 pending
//   · 前端显示"任务未执行完成（流程已结束，仍有步骤未执行）"
//
// 修复（与 routeAfterForceFinalize 的修复同源）：
//   1. routeAfterHumanReview：plan 执行中（plan_phase='executing'）拒绝/超时/错误
//      回 step_finalize 正常收尾
//   2. step_finalize：以 approval_status 为硬证据判 failed（不依赖消息层面推断，
//      防止"LLM 过程正文 + rejection ToolMessage"被降级模式误判 done）；
//      标记 stepResult.approval_blocked；不走自动重试；收尾后清理审批态
//   3. step_dispatch 节点：识别 approval_blocked → 剩余 pending 步骤一次性
//      skipped 收敛（plan_phase='finalizing'），不触发重规划
import { describe, it, expect, afterEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'

import { routeAfterHumanReview } from '@/graph/nodes.js'
import {
  makeStepFinalizeNode,
  makeStepDispatchNode,
  stepDispatch,
} from '@/graph/plan-execute/dispatcher.js'
import { getConfig, resetConfig } from '@/config/runtime-config.js'
import type { ModuAgentState } from '@/graph/state.js'

function planState(over: Record<string, any> = {}): ModuAgentState {
  const plan = [
    {
      step_id: 'step_1',
      title: '生成对比分析报告文档',
      status: 'running',
      description: '调用 doc_writer 生成 Markdown 报告',
      requires_tool: true,
    },
    { step_id: 'step_2', title: '校验报告完整性与准确性', status: 'pending', description: '校验报告' },
  ]
  return {
    plan,
    current_step_index: 0,
    current_step: { ...plan[0] },
    step_msg_baseline: 0,
    step_results: [],
    replan_count: 0,
    plan_phase: 'executing',
    ...over,
  } as unknown as ModuAgentState
}

describe('P0 · 审批被拒/超时后计划收敛', () => {
  afterEach(() => {
    resetConfig()
  })

  describe('routeAfterHumanReview', () => {
    it('plan 执行中审批拒绝 → step_finalize（不再直连 finalize_response）', () => {
      const state = planState({ approval_status: 'rejected' })
      expect(routeAfterHumanReview(state)).toBe('step_finalize')
    })

    it('plan 执行中审批超时 → step_finalize', () => {
      const state = planState({ approval_status: 'timeout' })
      expect(routeAfterHumanReview(state)).toBe('step_finalize')
    })

    it('plan 执行中审批错误 → step_finalize', () => {
      const state = planState({ approval_status: 'error' })
      expect(routeAfterHumanReview(state)).toBe('step_finalize')
    })

    it('行为不回归：ReAct 模式（plan_phase 为空）拒绝 → finalize_response', () => {
      const state = planState({ approval_status: 'rejected', plan_phase: '' })
      expect(routeAfterHumanReview(state)).toBe('finalize_response')
    })

    it('行为不回归：批准 → tools', () => {
      const state = planState({ approval_status: 'approved' })
      expect(routeAfterHumanReview(state)).toBe('tools')
    })
  })

  describe('step_finalize', () => {
    it('审批拒绝 → 本步判 failed 并标记 approval_blocked（即使 LLM 有过程正文）', async () => {
      // 回归点：有 AI 正文时原判定逻辑会走"降级/完成"路径；审批证据必须优先
      const state = planState({
        messages: [new AIMessage({ content: '我准备调用 doc_writer 生成报告。' })],
        approval_status: 'rejected',
      })
      const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>

      expect(String(updates.plan?.[0]?.['status'])).toBe('failed')
      expect(updates.plan_delta?.step_update?.status).toBe('failed')
      expect(String(updates.plan_delta?.step_update?.error ?? '')).toContain('approval')
      expect(updates.step_results?.[0]?.['approval_blocked']).toBe(true)
      // 审批态不得泄漏到后续步骤（step_finalize 以它判定"审批拦截"）
      expect(updates.approval_status).toBe('')
      expect(updates.tool_requires_approval).toBe(false)
    })

    it('审批超时同样判 failed 且标记 approval_blocked', async () => {
      const state = planState({
        messages: [new AIMessage({ content: '调用 doc_writer 写报告' })],
        approval_status: 'timeout',
      })
      const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
      expect(String(updates.plan?.[0]?.['status'])).toBe('failed')
      expect(updates.step_results?.[0]?.['approval_blocked']).toBe(true)
      expect(String(updates.plan_delta?.step_update?.error ?? '')).toContain('timeout')
    })

    it('审批拒绝不走自动重试（配置了重试预算也不会再次弹审批）', async () => {
      getConfig().update('plan_execute.step_retry.default_max_attempts', 3)
      const state = planState({
        messages: [],
        approval_status: 'rejected',
      })
      const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
      // 修复前会进入重试分支（status='retrying'），每次重试都会再次触发审批弹窗
      expect(updates.plan_delta?.step_update?.status).toBe('failed')
      expect(String(updates.plan?.[0]?.['status'])).toBe('failed')
    })

    it('行为不回归：正常步骤（审批已通过）仍按原逻辑判 done', async () => {
      // 去掉 requires_tool：本用例只验证"非审批拦截时保持原有失败判定逻辑"
      const state = planState({
        messages: [new AIMessage({ content: '报告已写好，结论如下…' })],
        approval_status: 'approved',
        plan: [
          { step_id: 'step_1', title: '生成对比分析报告文档', status: 'running' },
          { step_id: 'step_2', title: '校验报告完整性与准确性', status: 'pending' },
        ],
      })
      const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
      expect(String(updates.plan?.[0]?.['status'])).toBe('done')
      expect(updates.step_results?.[0]?.['approval_blocked']).toBeUndefined()
    })
  })

  describe('step_dispatch 收敛', () => {
    it('上一步 approval_blocked → 剩余 pending 全部 skipped、plan_phase=finalizing、路由 response', () => {
      const base = planState({
        current_step_index: 1,
        plan: [
          { step_id: 'step_1', title: '生成报告', status: 'failed' },
          { step_id: 'step_2', title: '校验报告', status: 'pending' },
          { step_id: 'step_3', title: '输出结论', status: 'pending' },
        ],
        step_results: [
          { step_id: 'step_1', status: 'failed', approval_blocked: true, replan: 0 },
        ],
      })
      const updates = makeStepDispatchNode()(base) as Record<string, any>

      expect(updates.plan_phase).toBe('finalizing')
      expect(String(updates.plan?.[1]?.['status'])).toBe('skipped')
      expect(String(updates.plan?.[2]?.['status'])).toBe('skipped')
      expect(updates.plan_delta?.step_updates).toHaveLength(2)
      expect(updates.plan_delta?.step_updates?.[0]?.status).toBe('skipped')

      // 全部终态后必须收敛到 response（而非 planner 重规划）
      const merged = { ...base, ...updates } as ModuAgentState
      expect(stepDispatch(merged)).toBe('response')
    })

    it('普通失败（无 approval_blocked）不触发审批收敛分支，保持原重规划/继续逻辑', () => {
      const base = planState({
        current_step_index: 1,
        plan: [
          { step_id: 'step_1', title: 'A', status: 'failed' },
          { step_id: 'step_2', title: 'B', status: 'pending' },
        ],
        step_results: [{ step_id: 'step_1', status: 'failed', replan: 0 }],
      })
      const updates = makeStepDispatchNode()(base) as Record<string, any>
      // 未被收敛分支接管：step_2 被正常激活为 running（走既有激活分支）
      expect(String(updates.plan?.[1]?.['status'])).toBe('running')
      expect(updates.plan_delta?.step_update?.status).toBe('running')
      expect(updates.plan_phase).toBeUndefined()
    })
  })
})
