// P1-3 回归测试：plan 基线（resume 场景）的产物与时间信息不得丢失
//
// 缺陷（实测会话 sess_b4bf4032…）：任务执行到第 5 步触发 HITL 暂停，
// 暂停时落库了 5 个步骤（step_1~4 已完成、含 result）；resume 段结束后再次落库
// （续写模式 deleteMany + create），结果 5 个步骤的 result 全部变成空串、
// started_at/finished_at 全部变成 null —— 已完成的步骤产物被清空。
//
// 根因两处：
//   1. resume 端点注入 ctx.planData 基线时只映射 step_id/title/description/status
//   2. mergePlanSteps 构建骨架时同样丢弃 result/error/started_at/finished_at
import { describe, it, expect } from 'vitest'

import { mergePlanSteps } from '../src/core/agent-bridge.js'

describe('mergePlanSteps · 基线字段保留（resume 续写场景）', () => {
  it('planData 自带的 result / error / 时间戳被保留', () => {
    // 模拟 resume 端点从 DB 读出的基线（已完成步骤）
    const planData = [
      {
        step_id: 'step_1',
        title: '梳理框架',
        description: 'd1',
        status: 'done',
        result: '框架内容…',
        started_at: 1000,
        finished_at: 2000,
      },
      {
        step_id: 'step_2',
        title: '撰写章节',
        description: 'd2',
        status: 'running',
        started_at: 2100,
      },
    ]
    const merged = mergePlanSteps(planData, [])

    expect(merged).toHaveLength(2)
    expect(merged[0].result).toBe('框架内容…')
    expect(merged[0].started_at).toBe(1000)
    expect(merged[0].finished_at).toBe(2000)
    expect(merged[1].result).toBeUndefined()
    expect(merged[1].started_at).toBe(2100)
  })

  it('基线字段可被本段 step_update 覆盖（后写覆盖语义不回归）', () => {
    const planData = [
      { step_id: 'step_1', title: 'T', description: 'D', status: 'running', started_at: 1000 },
    ]
    const merged = mergePlanSteps(planData, [
      { id: 'step_1', status: 'done', result: '本段新产物', finished_at: 3000 },
    ])

    expect(merged[0].status).toBe('done')
    expect(merged[0].result).toBe('本段新产物')
    expect(merged[0].started_at).toBe(1000)
    expect(merged[0].finished_at).toBe(3000)
  })

  it('无基线的普通场景行为不回归（仅靠 step_update 填充）', () => {
    const merged = mergePlanSteps(
      [{ step_id: 'step_1', title: 'T', description: 'D' }],
      [
        { id: 'step_1', status: 'running', started_at: 1 },
        { id: 'step_1', status: 'done', result: 'R', finished_at: 2 },
      ],
    )

    expect(merged[0].status).toBe('done')
    expect(merged[0].result).toBe('R')
    expect(merged[0].started_at).toBe(1)
    expect(merged[0].finished_at).toBe(2)
  })
})
