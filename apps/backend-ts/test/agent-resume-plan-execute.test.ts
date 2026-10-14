/**
 * resume 的图 profile 探测 —— 回归测试（2026-10-14）
 *
 * 缺陷（修复前）：streamAgentResume 固定用 get_runner()（默认图，plan_execute 关闭）
 * 恢复中断；而 plan_execute 中断的 checkpoint 状态 plan_phase='executing'，
 * routeAfterAgent 会返回 'step_finalize'——默认图未注册该条件目标 → LangGraph 抛
 * "Branch condition returned unknown or null destination"，任务在末步写文档时整体失败。
 *
 * 修复：_probePlanExecutePaused 读取中断状态，命中 plan_execute 时用对应 profile 的图。
 */
import { describe, it, expect } from 'vitest'

import { _probePlanExecutePaused } from '../src/core/agent-bridge.js'

function fakeGraph(values: Record<string, any> | null): any {
  return {
    getState: async () =>
      values === null
        ? null
        : {
            next: ['human_review'],
            values,
            tasks: [{ interrupts: [{ value: { kind: 'tool_confirm' } }] }],
            metadata: {},
          },
  }
}

describe('_probePlanExecutePaused（resume 图 profile 选择）', () => {
  it('checkpoint plan_phase=executing → true（应使用 plan_execute 图）', async () => {
    expect(
      await _probePlanExecutePaused(fakeGraph({ plan_phase: 'executing' }), 's1'),
    ).toBe(true)
  })

  it('plan 数组非空（plan_phase 缺失的容错路径）→ true', async () => {
    expect(
      await _probePlanExecutePaused(fakeGraph({ plan_phase: '', plan: [{}] }), 's1'),
    ).toBe(true)
  })

  it('普通 ReAct 中断 → false（沿用默认图，不回归）', async () => {
    expect(await _probePlanExecutePaused(fakeGraph({ user_id: 'u1' }), 's1')).toBe(false)
  })

  it('无 checkpoint（null）→ false（保持既有行为）', async () => {
    expect(await _probePlanExecutePaused(fakeGraph(null), 's1')).toBe(false)
  })

  it('状态读取异常 → false（降级，不抛出）', async () => {
    const broken = {
      getState: async () => {
        throw new Error('boom')
      },
    } as any
    expect(await _probePlanExecutePaused(broken, 's1')).toBe(false)
  })
})
