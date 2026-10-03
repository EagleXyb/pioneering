// ============================================================
// Clarify Metrics 单测（阶段2 灰度观测）
//
// node 环境无 localStorage → 走内存降级分支；测完显式 reset，
// 避免模块级单例计数跨用例串扰。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getClarifyMetrics,
  resetClarifyMetrics,
  trackClarifyAnswered,
  trackClarifyExpired,
  trackClarifySkipped,
  trackClarifyTriggered
} from '../clarify-metrics'

beforeEach(() => {
  resetClarifyMetrics()
})

describe('clarify-metrics', () => {
  it('同一会话同一类型的暂停项只计一次 triggered（recover 补挂不重复计数）', () => {
    trackClarifyTriggered('s1', 'clarifying')
    trackClarifyTriggered('s1', 'clarifying')
    trackClarifyTriggered('s1', 'choice')
    expect(getClarifyMetrics().triggered).toBe(2)
  })

  it('工具审批（tool_confirm）不进入澄清统计', () => {
    trackClarifyTriggered('s1', 'tool_confirm')
    trackClarifyAnswered('s1', 'tool_confirm')
    trackClarifySkipped('s1', 'tool_confirm')
    trackClarifyExpired('s1', 'tool_confirm')
    const m = getClarifyMetrics()
    expect(m.triggered + m.answered + m.skipped + m.expired).toBe(0)
  })

  it('回答成功记 answered 并累计耗时；skipRate 只在有裁决样本时给出', () => {
    trackClarifyTriggered('s1', 'clarifying')
    trackClarifyAnswered('s1', 'clarifying')
    const m = getClarifyMetrics()
    expect(m.answered).toBe(1)
    expect(m.triggered).toBe(1)
    expect(m.avgAnswerLatencyMs).not.toBeNull()
    expect(m.avgAnswerLatencyMs!).toBeGreaterThanOrEqual(0)
    // 无跳过样本 → skipRate = 0
    expect(m.skipRate).toBe(0)
  })

  it('跳过计入误触发率分子：1 次跳过 + 1 次回答 → skipRate=0.5', () => {
    trackClarifyTriggered('s1', 'clarifying')
    trackClarifyAnswered('s1', 'clarifying')
    trackClarifyTriggered('s2', 'clarifying')
    trackClarifySkipped('s2', 'clarifying')
    const m = getClarifyMetrics()
    expect(m.skipped).toBe(1)
    expect(m.skipRate).toBe(0.5)
  })

  it('超时/失效收敛记 expired；reset 清空全部计数', () => {
    trackClarifyTriggered('s1', 'choice')
    trackClarifyExpired('s1', 'choice')
    expect(getClarifyMetrics().expired).toBe(1)

    resetClarifyMetrics()
    const m = getClarifyMetrics()
    expect(m.triggered).toBe(0)
    expect(m.answered).toBe(0)
    expect(m.skipped).toBe(0)
    expect(m.expired).toBe(0)
    expect(m.skipRate).toBeNull()
    expect(m.avgAnswerLatencyMs).toBeNull()
  })
})
