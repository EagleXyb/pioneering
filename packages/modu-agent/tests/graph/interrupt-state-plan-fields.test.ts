/**
 * get_interrupt_state 透出 plan_execute 中断上下文（2026-10-14）
 *
 * 缺陷背景：plan_execute 任务在末步（生成结构化文档）触发 HITL 中断后，
 * resume 用默认（plan_execute 关闭）图恢复 → routeAfterAgent 依据 checkpoint 的
 * plan_phase='executing' 返回 'step_finalize'，而该图未注册此条件目标 →
 * LangGraph 抛 "Branch condition returned unknown or null destination"，整个 run 失败。
 *
 * 修复：get_interrupt_state 透出 plan_phase / plan_steps，resume 侧据其选择图 profile。
 */
import { describe, it, expect } from 'vitest'

import { get_interrupt_state } from '@/graph/runner.js'

function fakeGraph(
  values: Record<string, any>,
  next: string[] = ['human_review'],
): any {
  return {
    getState: async () => ({
      next,
      values,
      tasks: [{ interrupts: [{ value: { kind: 'tool_confirm', session_id: 's1' } }] }],
      metadata: { created_at: '2026-10-14T06:00:00Z' },
    }),
  }
}

describe('get_interrupt_state · plan_execute 中断上下文透出', () => {
  it('plan_phase=executing 时透出 plan_phase 与 plan_steps（resume 据此选图）', async () => {
    const st = await get_interrupt_state(
      fakeGraph({ plan_phase: 'executing', plan: [{}, {}, {}], user_id: 'u1' }),
      's1',
    )

    expect(st).not.toBeNull()
    expect(st!['plan_phase']).toBe('executing')
    expect(st!['plan_steps']).toBe(3)
  })

  it('普通 ReAct 中断（无 plan 字段）：透出空值，不回归', async () => {
    const st = await get_interrupt_state(fakeGraph({ user_id: 'u1' }), 's1')

    expect(st).not.toBeNull()
    expect(st!['plan_phase']).toBe('')
    expect(st!['plan_steps']).toBe(0)
  })

  it('非 interrupt 暂停（next 无 interrupt 节点）→ null，不回归', async () => {
    const st = await get_interrupt_state(
      fakeGraph({ plan_phase: 'executing' }, ['agent']),
      's1',
    )

    expect(st).toBeNull()
  })
})
