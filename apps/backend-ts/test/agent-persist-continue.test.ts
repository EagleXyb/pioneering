/**
 * 任务模式持久化：暂停/错误落库 + 续写合并（2026-10-14）
 *
 * 缺陷背景（用户报告"刷新后回复就不见了"）：原实现仅在"正常完成"时落库，
 * HITL 暂停 / 流错误 / 用户中止的 run 一律不落库 → 刷新后内容全丢。
 *
 * 修复：① 有内容就落库（暂停/错误/中止）；
 *       ② resume 段正文追加到暂停时落库的同一条消息（mergeContinueContent）；
 *       ③ metadata.plan_phase 按终态正确标记（resolvePersistPlanPhase）。
 */
import { describe, it, expect } from 'vitest'

import {
  mergeContinueContent,
  resolvePersistPlanPhase,
} from '../src/routes/agent.js'
import { StreamContext } from '../src/core/agent-bridge.js'

describe('mergeContinueContent（HITL 续写正文合并）', () => {
  it('无上一段：取本段', () => {
    expect(mergeContinueContent('', '本段正文')).toBe('本段正文')
  })

  it('本段为空：保留上一段（刷新后内容不丢的关键路径）', () => {
    expect(mergeContinueContent('已生成内容', '')).toBe('已生成内容')
  })

  it('正常续写：上一段 + 本段', () => {
    expect(mergeContinueContent('前半段', '后半段')).toBe('前半段后半段')
  })

  it('模型重放整段（本段以上一段开头）：取本段，不重复拼接', () => {
    expect(mergeContinueContent('前半段', '前半段后半段')).toBe('前半段后半段')
  })

  it('本段是上一段的子串（重复下发）：保留上一段', () => {
    expect(mergeContinueContent('前半段后半段', '后半段')).toBe('前半段后半段')
  })
})

describe('resolvePersistPlanPhase（落库 metadata.plan_phase 判定）', () => {
  it('流错误 / RUN_ERROR → error', () => {
    const ctx = new StreamContext()
    ctx.hasError = true
    expect(resolvePersistPlanPhase(ctx)).toBe('error')

    const ctx2 = new StreamContext()
    ctx2.planPhase = 'error'
    expect(resolvePersistPlanPhase(ctx2)).toBe('error')
  })

  it('HITL 暂停 → executing（刷新后仍可恢复步骤面板）', () => {
    const ctx = new StreamContext()
    ctx.paused = true
    expect(resolvePersistPlanPhase(ctx)).toBe('executing')
  })

  it('正常完成 / 用户中止 → done（中止段内容保留且不标失败）', () => {
    expect(resolvePersistPlanPhase(new StreamContext())).toBe('done')

    const aborted = new StreamContext()
    aborted.abortReason = 'user_cancel'
    expect(resolvePersistPlanPhase(aborted)).toBe('done')
  })

  // ===== P1-3：按步骤实际状态推导（不再恒为 done）=====
  // 缺陷（实测 sess_d7185e5c…）：7 步计划只跑完第 1 步（step_1=running、step_2~6=pending），
  // 但落库 metadata.plan_phase='done' → 刷新后徽章"已完成"、进度"已完成 0/7 步"自相矛盾。
  it('P1-3：仍有 pending 步骤 → incomplete（不再谎报 done）', () => {
    expect(
      resolvePersistPlanPhase(new StreamContext(), [
        { status: 'done' },
        { status: 'pending' },
        { status: 'pending' },
      ]),
    ).toBe('incomplete')
  })

  it('P1-3：仍有 running / retrying 步骤 → incomplete', () => {
    expect(resolvePersistPlanPhase(new StreamContext(), [{ status: 'running' }])).toBe('incomplete')
    expect(resolvePersistPlanPhase(new StreamContext(), [{ status: 'retrying' }])).toBe('incomplete')
  })

  it('P1-3：全部终态（done/failed/skipped）→ done', () => {
    expect(
      resolvePersistPlanPhase(new StreamContext(), [
        { status: 'done' },
        { status: 'failed' },
        { status: 'skipped' },
      ]),
    ).toBe('done')
  })

  it('P1-3：无步骤数据 → 行为不回归（done）', () => {
    expect(resolvePersistPlanPhase(new StreamContext(), [])).toBe('done')
    expect(resolvePersistPlanPhase(new StreamContext())).toBe('done')
  })

  it('P1-3：错误优先于步骤状态；暂停优先于步骤状态', () => {
    const errCtx = new StreamContext()
    errCtx.hasError = true
    expect(resolvePersistPlanPhase(errCtx, [{ status: 'pending' }])).toBe('error')

    const pausedCtx = new StreamContext()
    pausedCtx.paused = true
    expect(resolvePersistPlanPhase(pausedCtx, [{ status: 'pending' }])).toBe('executing')
  })
})
