/**
 * Agent TTL 调度器单元测试（T2.2）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sweep: vi.fn(),
  getRunner: vi.fn(async () => ({})),
  checkTimeout: vi.fn(async () => 'active'),
}))

vi.mock('@pioneering/modu-agent', () => ({
  get_runner: mocks.getRunner,
  sweepExpiredInterrupts: mocks.sweep,
  checkInterruptTimeout: mocks.checkTimeout,
}))

import {
  trackInterruptSession,
  untrackInterruptSession,
  getTrackedInterruptSessions,
  sweepOnce,
  startInterruptScheduler,
  stopInterruptScheduler,
} from '../src/core/agent-scheduler.js'

describe('agent-scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.sweep.mockReset()
    stopInterruptScheduler()
    // 清空模块级跟踪集合，避免跨用例残留
    for (const id of getTrackedInterruptSessions()) untrackInterruptSession(id)
  })

  afterEach(() => {
    stopInterruptScheduler()
    vi.useRealTimers()
  })

  it('track/untrack 维护会话集合', () => {
    expect(getTrackedInterruptSessions()).toEqual([])
    trackInterruptSession('s1')
    trackInterruptSession('s2')
    expect(getTrackedInterruptSessions().sort()).toEqual(['s1', 's2'])
    untrackInterruptSession('s1')
    expect(getTrackedInterruptSessions()).toEqual(['s2'])
  })

  it('定时触发 sweep（60s）', async () => {
    trackInterruptSession('s1')
    mocks.sweep.mockResolvedValue({ s1: 'active' })

    startInterruptScheduler()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(mocks.sweep).toHaveBeenCalledWith({}, ['s1'])
  })

  it('sweep 后自动剔除 expired / no_interrupt 会话', async () => {
    trackInterruptSession('s1')
    trackInterruptSession('s2')
    mocks.sweep.mockResolvedValue({ s1: 'expired', s2: 'active' })

    await sweepOnce()

    expect(getTrackedInterruptSessions()).toEqual(['s2'])
  })

  it('空集合时不调用 sweep', async () => {
    await sweepOnce()
    expect(mocks.sweep).not.toHaveBeenCalled()
  })

  it('start 幂等：重复调用只有一个定时器', async () => {
    trackInterruptSession('s1')
    mocks.sweep.mockResolvedValue({ s1: 'active' })

    startInterruptScheduler()
    startInterruptScheduler()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(mocks.sweep).toHaveBeenCalledTimes(1)
  })

  it('stop 后不再触发', async () => {
    trackInterruptSession('s1')
    startInterruptScheduler()
    stopInterruptScheduler()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mocks.sweep).not.toHaveBeenCalled()
  })
})
