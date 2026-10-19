// P0-4 回归测试（2026-10-14）：
//
// 缺陷（实测会话 sess_d7185e5c…）：任务模式下一份文档被写了两次、审批两次。
// 15:20:17 doc_writer（标题 A）→ HITL 审批① → 批准 → 15:22:19 落盘；
// 15:25:15 doc_writer（标题 B）→ HITL 审批② → 批准 → 15:27:17 落盘第二份。
//
// 根因：doc-gen 防重写守卫（nodes.ts routeAfterAgent）以
//   `state.task_type === 'document_generation'` 为前提，而 task_type 由 perception
//   按**用户原文关键词**（文档/报告/文件…）判定。用户原文是"请深入、全面、系统地
//   解释……核心概念"，不含这些词 → task_type=null → 守卫完全失效。
//
// 修复：
//   1. 守卫判定补充"本轮已产出文档产物（artifacts 含 doc_writer/document）"——
//      以既成事实为准，不再依赖意图猜测
//   2. 守卫触发的"终止"在 plan_execute 下改为回到 step_finalize（只终结当前步骤），
//      不直接 __end__ —— 否则剩余步骤被静默丢弃（与 P0-2 同源）
import { describe, it, expect } from 'vitest'
import { AIMessage } from '@langchain/core/messages'

import { routeAfterAgent } from '@/graph/nodes.js'
import type { ModuAgentState } from '@/graph/state.js'

function docWriterCallState(over: Record<string, any> = {}): ModuAgentState {
  return {
    messages: [
      new AIMessage({
        content: '我已整理好内容，现在写入文档。',
        tool_calls: [
          { id: 'call_1', name: 'doc_writer', args: { op: 'create', title: 'X' } } as any,
        ],
      }),
    ],
    artifacts: [{ tool: 'doc_writer', type: 'document', name: 'X_2026-10-14.md' }],
    task_type: null,
    doc_writer_succeeded: false,
    doc_writer_fail_count: 0,
    complexity_assessment: null,
    step_round_count: 0,
    reasoning_round_count: 0,
    ...over,
  } as unknown as ModuAgentState
}

describe('P0-4 · doc-gen 防重写守卫在 plan_execute 下生效', () => {
  it('已产出文档 + 再次调用 doc_writer（task_type=null）→ 守卫拦截', () => {
    // 修复前：task_type=null → isDocGen=false → 不做任何拦截 → 'tools'（重复写 + 重复审批）
    const state = docWriterCallState({ plan_phase: '' })
    expect(routeAfterAgent(state)).toBe('__end__')
  })

  it('plan_execute 下拦截后回到 step_finalize（不丢弃剩余步骤）', () => {
    const state = docWriterCallState({ plan_phase: 'executing' })
    expect(routeAfterAgent(state)).toBe('step_finalize')
  })

  it('doc_writer 已成功且提醒已注入 → 终止；plan 模式下同样只终结当前步骤', () => {
    const state = docWriterCallState({
      plan_phase: 'executing',
      doc_writer_succeeded: true,
      doc_final_answer_enforced: true,
    })
    expect(routeAfterAgent(state)).toBe('step_finalize')
  })

  it('doc_writer 连续失败 2 次 → 终止；plan 模式下回到 step_finalize', () => {
    const state = docWriterCallState({
      plan_phase: 'executing',
      doc_writer_fail_count: 2,
    })
    expect(routeAfterAgent(state)).toBe('step_finalize')
  })

  it('行为不回归：task_type=document_generation 时 ReAct 模式仍返回 __end__', () => {
    const state = docWriterCallState({
      plan_phase: '',
      task_type: 'document_generation',
    })
    expect(routeAfterAgent(state)).toBe('__end__')
  })

  it('行为不回归：无文档产物且非文档任务 → 正常走 tools 分支', () => {
    const state = docWriterCallState({
      plan_phase: 'executing',
      artifacts: [],
      messages: [
        new AIMessage({
          content: '我去检索一下',
          tool_calls: [
            { id: 'call_1', name: 'web_search', args: { q: 'x' } } as any,
          ],
        }),
      ],
    })
    expect(routeAfterAgent(state)).toBe('tools')
  })
})
