/**
 * P2 回归测试（2026-10-14）：计划依赖引用规整与 replan 重编号。
 *
 * 缺陷背景：
 *   1. _parsePlan 强制把 step_id 重编号为 step_{i+1}，却原样保留 depends_on——
 *      LLM 用 "1"/"步骤1"/标题/别名（dependencies）引用依赖时永远匹配不上，
 *      dispatcher 判定"永不就绪"→ 执行死锁（No ready steps）。
 *   2. 部分重规划拼接 [已完成步骤, 新步骤] 时两段 step_id 重叠 → 重复 id，
 *      前端 items[id] 相互覆盖 / step_update 落到错误节点。
 *
 * 修复：字段别名归一 + 依赖引用映射（支持序号/标题等形式，无法解析丢弃、自引用过滤）
 *      + replan 新步骤重编号（从保留步骤数量之后开始并同步重写依赖）。
 */
import { describe, it, expect } from 'vitest'

import { _parsePlan, _renumberReplanPlan } from '@/graph/plan-execute/planner.js'
import type { PlanStep } from '@/graph/plan-execute/types.js'

function planJson(steps: unknown[]): string {
  return JSON.stringify({ goal: '输出一份说明文档', steps })
}

describe('P2 · _parsePlan 依赖引用规整', () => {
  it('dependencies 别名字段归一 → 依赖生效', () => {
    const plan = _parsePlan(
      planJson([
        { step_id: 's1', title: '梳理大纲', description: '梳理章节结构' },
        { step_id: 's2', title: '撰写章节', description: '撰写正文', dependencies: ['s1'] },
      ]),
      10,
    )

    expect(plan).not.toBeNull()
    expect(plan![0].step_id).toBe('step_1')
    expect(plan![1].step_id).toBe('step_2')
    expect(plan![1].depends_on).toEqual(['step_1'])
  })

  it('序号引用（"1"）映射到重编号后的 step_1', () => {
    const plan = _parsePlan(
      planJson([
        { step_id: 'a', title: '第一步', description: '准备资料' },
        { step_id: 'b', title: '第二步', description: '整理输出', depends_on: ['1'] },
      ]),
      10,
    )

    expect(plan![1].depends_on).toEqual(['step_1'])
  })

  it('标题引用映射到对应 step_id', () => {
    const plan = _parsePlan(
      planJson([
        { step_id: 'a', title: '梳理大纲', description: '梳理章节结构' },
        { step_id: 'b', title: '撰写章节', description: '撰写正文', depends_on: ['梳理大纲'] },
      ]),
      10,
    )

    expect(plan![1].depends_on).toEqual(['step_1'])
  })

  it('无法解析的依赖引用丢弃（降级无依赖，避免死锁）', () => {
    const plan = _parsePlan(
      planJson([
        { step_id: 'a', title: '第一步', description: '准备资料' },
        { step_id: 'b', title: '第二步', description: '整理输出', depends_on: ['ghost_step'] },
      ]),
      10,
    )

    expect(plan![1].depends_on).toBeUndefined()
  })

  it('自引用依赖被过滤（否则该步永不就绪）', () => {
    const plan = _parsePlan(
      planJson([
        { step_id: 'step_1', title: '第一步', description: '准备资料' },
        { step_id: 'step_2', title: '第二步', description: '整理输出', depends_on: ['step_2'] },
      ]),
      10,
    )

    expect(plan![1].depends_on).toBeUndefined()
  })

  it('混合引用（有效 + 无效）只保留有效项', () => {
    const plan = _parsePlan(
      planJson([
        { step_id: 'a', title: '第一步', description: '准备资料' },
        { step_id: 'b', title: '第二步', description: '撰写正文' },
        { step_id: 'c', title: '第三步', description: '汇总输出', depends_on: ['a', 'not_exist'] },
      ]),
      10,
    )

    expect(plan![2].depends_on).toEqual(['step_1'])
  })
})

describe('P2 · _renumberReplanPlan 重规划重编号', () => {
  it('新步骤避开保留步骤 id，依赖引用同步映射', () => {
    const newSteps: PlanStep[] = [
      { step_id: 'step_1', title: '补写章节', description: 'D', status: 'pending', depends_on: ['step_2'] },
      { step_id: 'step_2', title: '汇总', description: 'D', status: 'pending', depends_on: ['step_1'] },
    ]

    const out = _renumberReplanPlan(newSteps, 1)

    expect(out.map((s) => s.step_id)).toEqual(['step_2', 'step_3'])
    expect(out[0].depends_on).toEqual(['step_3'])
    expect(out[1].depends_on).toEqual(['step_2'])
  })

  it('重编号后自引用被过滤', () => {
    const newSteps: PlanStep[] = [
      { step_id: 'step_1', title: 'A', description: 'D', status: 'pending', depends_on: ['step_1'] },
    ]

    const out = _renumberReplanPlan(newSteps, 2)

    expect(out[0].step_id).toBe('step_3')
    expect(out[0].depends_on).toBeUndefined()
  })

  it('offset=0（无保留步骤）时编号保持 step_1..N（不回归）', () => {
    const newSteps: PlanStep[] = [
      { step_id: 'step_1', title: 'A', description: 'D', status: 'pending' },
      { step_id: 'step_2', title: 'B', description: 'D', status: 'pending', depends_on: ['step_1'] },
    ]

    const out = _renumberReplanPlan(newSteps, 0)

    expect(out.map((s) => s.step_id)).toEqual(['step_1', 'step_2'])
    expect(out[1].depends_on).toEqual(['step_1'])
  })
})
