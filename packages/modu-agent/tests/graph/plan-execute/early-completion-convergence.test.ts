// P0-3 回归测试（2026-10-14）：
//
// 缺陷（实测会话 sess_d7185e5c…）：planner 拆出 7 步（step_1 框架、step_2~6 分章、
// step_7 整合写文档），但 LLM 在 step_1 就调用 doc_writer 写完了整份文档，
// step_2~step_6 变成纯粹的重复劳动，计划被架空、用户看不到"计划"的价值。
//
// 根因：
//   1. 步骤注入的上下文里只有"当前步骤是什么"，没有职责边界约束，
//      也没有把 planner 产出的 expected_output / verification_hint 交给执行器
//   2. 执行器从不检测"本步是否已产出整体交付物"，因此无法收敛计划
//
// 修复：
//   1. plan-execute/context.ts：注入 SCOPE 边界 + expected_output / verification_hint
//   2. step_finalize：检测本步是否越级产出整体交付物 → step_results[].early_completion
//   3. step_dispatch：命中 early_completion 时一次性跳过后续"纯推理/写作类"
//      冗余步骤（下发多条 step_update），并激活下一个真正需要执行的步骤
import { describe, it, expect, afterEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'

import {
  makeStepDispatchNode,
  makeStepFinalizeNode,
} from '@/graph/plan-execute/dispatcher.js'
import { getConfig, resetConfig } from '@/config/runtime-config.js'
import type { ModuAgentState } from '@/graph/state.js'

function baseState(over: Record<string, any> = {}): ModuAgentState {
  return {
    plan: [],
    current_step_index: 0,
    current_step: {},
    step_msg_baseline: 0,
    messages: [],
    step_results: [],
    replan_count: 0,
    artifacts: [],
    ...over,
  } as unknown as ModuAgentState
}

/** 复刻实测计划：step_1 框架（已完成且越级产出终稿），step_2~4 分章，step_5 整合（需工具） */
function planAfterEarlyStep1(): Array<Record<string, any>> {
  return [
    { step_id: 'step_1', title: '构建框架', status: 'done', requires_tool: false },
    { step_id: 'step_2', title: '撰写章节A', status: 'pending', requires_tool: false },
    { step_id: 'step_3', title: '撰写章节B', status: 'pending', requires_tool: false },
    { step_id: 'step_4', title: '检索补充资料', status: 'pending', requires_tool: true },
    { step_id: 'step_5', title: '整合并写文档', status: 'pending', requires_tool: true },
  ]
}

describe('P0-3 · 提前交付检测与收敛', () => {
  afterEach(() => {
    resetConfig()
  })

  describe('step_finalize：标记 early_completion', () => {
    it('仅有长正文但无文档产物 → 不标记（避免把详尽大纲误判为终稿）', async () => {
      // 实测教训：step_1「梳理知识框架与讲解大纲」就能写到 2000+ 字，
      // 若按长度判定，后面真正撰写内容的步骤会被全部跳过，最终只剩大纲。
      const state = baseState({
        plan: [
          { step_id: 'step_1', title: 'A', status: 'running' },
          { step_id: 'step_2', title: 'B', status: 'pending' },
        ],
        current_step_index: 0,
        messages: [new AIMessage({ content: '稿'.repeat(2500) })],
      })
      const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
      expect(updates.step_results?.[0]?.['early_completion']).toBeUndefined()
    })

    it('本步已产出文档产物（artifacts）→ 标记 early_completion', async () => {
      const state = baseState({
        plan: [
          { step_id: 'step_1', title: 'A', status: 'running' },
          { step_id: 'step_2', title: 'B', status: 'pending' },
        ],
        current_step_index: 0,
        messages: [new AIMessage({ content: '已为你生成文档。' })],
        artifacts: [{ type: 'document', tool: 'doc_writer', name: 'x.md' }],
      })
      const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
      expect(updates.step_results?.[0]?.['early_completion']).toBe(true)
    })

    it('最后一步不标记（本来就该产出终稿）', async () => {
      const state = baseState({
        plan: [
          { step_id: 'step_1', title: 'A', status: 'done' },
          { step_id: 'step_2', title: 'B', status: 'running' },
        ],
        current_step_index: 1,
        messages: [new AIMessage({ content: '稿'.repeat(2500) })],
      })
      const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
      expect(updates.step_results?.[0]?.['early_completion']).toBeUndefined()
    })

    it('短输出且无文档产物 → 不标记（行为不回归）', async () => {
      const state = baseState({
        plan: [
          { step_id: 'step_1', title: 'A', status: 'running' },
          { step_id: 'step_2', title: 'B', status: 'pending' },
        ],
        current_step_index: 0,
        messages: [new AIMessage({ content: '本步结论：A 优于 B。' })],
      })
      const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
      expect(updates.step_results?.[0]?.['early_completion']).toBeUndefined()
    })
  })

  describe('step_dispatch：跳过冗余步骤并激活下一个待执行步骤', () => {
    it('命中 early_completion → 跳过纯推理步骤，激活第一个 requires_tool 步骤', () => {
      const plan = planAfterEarlyStep1()
      const state = baseState({
        plan,
        plan_phase: 'executing',
        current_step_index: 1,
        step_results: [
          { step_id: 'step_1', status: 'done', replan: 0, early_completion: true },
        ],
        replan_count: 0,
      })
      const updates = makeStepDispatchNode()(state) as Record<string, any>

      const byId = (id: string) => updates.plan?.find((s: any) => s.step_id === id)
      expect(String(byId('step_2')?.['status'])).toBe('skipped')
      expect(String(byId('step_3')?.['status'])).toBe('skipped')
      // requires_tool=true 的步骤必须保留执行（不能失去外部数据）
      expect(String(byId('step_4')?.['status'])).toBe('running')
      expect(updates.current_step_index).toBe(3)

      // 一次调用下发多条 step_update，前端才能看到 skipped 状态
      const su = updates.plan_delta?.step_updates ?? []
      expect(su.length).toBe(3)
      expect(su.map((u: any) => u.status)).toEqual(['skipped', 'skipped', 'running'])
      expect(su[0].result).toContain('跳过')
    })

    it('无 requires_tool 步骤时只保留最后一步执行（最后一步不得被跳过）', () => {
      const plan = [
        { step_id: 'step_1', title: 'A', status: 'done', requires_tool: false },
        { step_id: 'step_2', title: 'B', status: 'pending', requires_tool: false },
        { step_id: 'step_3', title: 'C（整合）', status: 'pending', requires_tool: false },
      ]
      const state = baseState({
        plan,
        plan_phase: 'executing',
        current_step_index: 1,
        step_results: [
          { step_id: 'step_1', status: 'done', replan: 0, early_completion: true },
        ],
      })
      const updates = makeStepDispatchNode()(state) as Record<string, any>

      expect(String(updates.plan?.find((s: any) => s.step_id === 'step_2')?.['status'])).toBe('skipped')
      expect(String(updates.plan?.find((s: any) => s.step_id === 'step_3')?.['status'])).toBe('running')
      expect(updates.current_step_index).toBe(2)
    })

    it('未命中 early_completion → 行为不回归（正常激活当前 pending 步骤）', () => {
      const plan = [
        { step_id: 'step_1', title: 'A', status: 'running', requires_tool: false },
        { step_id: 'step_2', title: 'B', status: 'pending', requires_tool: false },
      ]
      const state = baseState({
        plan,
        plan_phase: 'executing',
        current_step_index: 1,
        step_results: [],
      })
      const updates = makeStepDispatchNode()(state) as Record<string, any>

      expect(String(updates.plan?.[1]?.['status'])).toBe('running')
      expect(updates.plan_delta?.step_update?.status).toBe('running')
      expect(updates.plan_delta?.step_updates).toBeUndefined()
    })

    it('跨代际的旧 early_completion 不生效（replan 后重新执行）', () => {
      const plan = planAfterEarlyStep1()
      const state = baseState({
        plan,
        plan_phase: 'executing',
        current_step_index: 1,
        // 上一代际（replan=0）的标记，当前代际 replan=1 → 不应命中
        step_results: [
          { step_id: 'step_1', status: 'done', replan: 0, early_completion: true },
        ],
        replan_count: 1,
      })
      const updates = makeStepDispatchNode()(state) as Record<string, any>

      expect(String(updates.plan?.[1]?.['status'])).toBe('running')
      expect(updates.plan_delta?.step_updates).toBeUndefined()
    })

    describe('P2-4 · 输出被 max_tokens 截断时透出标记', () => {
    it('output_truncated 为真 → 步骤结果与 SSE 都带 truncated', async () => {
      const state = baseState({
        plan: [
          { step_id: 'step_1', title: 'A', status: 'running' },
          { step_id: 'step_2', title: 'B', status: 'pending' },
        ],
        current_step_index: 0,
        messages: [new AIMessage({ content: '被截断的长文…' })],
        output_truncated: true,
      })
      const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
      expect(updates.step_results?.[0]?.['truncated']).toBe(true)
      expect(updates.plan_delta?.step_update?.truncated).toBe(true)
      // 复位，避免泄漏到下一步
      expect(updates.output_truncated).toBe(false)
    })

    it('未截断时不写标记（行为不回归）', async () => {
      const state = baseState({
        plan: [{ step_id: 'step_1', title: 'A', status: 'running' }],
        current_step_index: 0,
        messages: [new AIMessage({ content: '完整输出' })],
      })
      const updates = (await makeStepFinalizeNode()(state)) as Record<string, any>
      expect(updates.step_results?.[0]?.['truncated']).toBeUndefined()
      expect(updates.output_truncated).toBeUndefined()
    })
  })

  it('末步（整合/交付步骤）永远不被跳过，按原逻辑正常激活', () => {
      const plan = [
        { step_id: 'step_1', title: 'A', status: 'done', requires_tool: false },
        { step_id: 'step_2', title: 'B（整合交付）', status: 'pending', requires_tool: false },
      ]
      const state = baseState({
        plan,
        plan_phase: 'executing',
        current_step_index: 1,
        step_results: [
          { step_id: 'step_1', status: 'done', replan: 0, early_completion: true },
        ],
      })
      const updates = makeStepDispatchNode()(state) as Record<string, any>

      // 最后一步必须保留执行：它是整合/交付步骤，跳过会导致没有最终产出
      expect(String(updates.plan?.[1]?.['status'])).toBe('running')
      // 走的是原激活路径（单条 step_update、不重写 current_step_index）
      expect(updates.current_step_index).toBeUndefined()
      expect(updates.plan_delta?.step_update?.status).toBe('running')
      expect(updates.plan_delta?.step_updates).toBeUndefined()
    })
  })
})
