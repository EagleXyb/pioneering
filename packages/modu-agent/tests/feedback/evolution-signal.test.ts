import { describe, it, expect } from 'vitest'
import { EvolutionSignalCollector } from '@/feedback/evolution-signal.js'
import { AgentEvent } from '@/orchestration/communication/protocol.js'

function makeEvent(): AgentEvent {
  return new AgentEvent({
    user_id: 'u1',
    session_id: 's1',
    domain: 'reasoning',
    action: 'generate',
    priority: 'normal',
  })
}

describe('EvolutionSignalCollector', () => {
  it('collects a signal every report interval', () => {
    const c = new EvolutionSignalCollector(1)
    c.onAgentEvent(makeEvent())
    expect(c.getSignals().length).toBe(1)
  })

  it('respects the report interval', () => {
    const c = new EvolutionSignalCollector(2)
    c.onAgentEvent(makeEvent())
    expect(c.getSignals().length).toBe(0)
    c.onAgentEvent(makeEvent())
    expect(c.getSignals().length).toBe(1)
  })

  it('clamps a zero report interval to 1 and still records', () => {
    const c = new EvolutionSignalCollector(0)
    c.onAgentEvent(makeEvent())
    expect(c.getSignals().length).toBe(1)
  })

  it('ignores null events', () => {
    const c = new EvolutionSignalCollector(1)
    c.onAgentEvent(null)
    expect(c.getSignals().length).toBe(0)
  })

  // === P1-9：信号环形上限 500 ===
  describe('P1-9 信号环形上限', () => {
    it('超过 500 条后只保留最近 500 条（最旧被丢弃）', () => {
      const c = new EvolutionSignalCollector(1)
      for (let i = 0; i < 502; i++) c.onAgentEvent(makeEvent())

      const signals = c.getSignals()
      expect(signals).toHaveLength(500)
      // 缓冲稳态：最新信号仍在
      expect(signals[signals.length - 1]).toBeDefined()
    })

    it('保留的信号为最新批次（与最新事件 id 一致）', () => {
      const c = new EvolutionSignalCollector(1)
      const lastIds: string[] = []
      for (let i = 0; i < 503; i++) {
        const ev = makeEvent()
        if (i >= 500) lastIds.push(ev.event_id) // 最后 3 个事件 id
        c.onAgentEvent(ev)
      }
      const retainedIds = c.getSignals().map((s) => s.context.event_id)
      for (const id of lastIds) expect(retainedIds).toContain(id)
      expect(retainedIds).toHaveLength(500)
    })

    it('getSignals(sampleCount) 取最近 N 条（slice(-N) 语义）', () => {
      const c = new EvolutionSignalCollector(1)
      for (let i = 0; i < 10; i++) c.onAgentEvent(makeEvent())
      expect(c.getSignals(3)).toHaveLength(3)
      expect(c.getSignals(0)).toEqual([])
      expect(c.getSignals(100)).toHaveLength(10) // 不足 N 时返回全部
      expect(c.getSignals()).toHaveLength(10)
    })

    it('getSignals 返回副本，外部修改不影响内部缓冲', () => {
      const c = new EvolutionSignalCollector(1)
      c.onAgentEvent(makeEvent())
      const snap1 = c.getSignals()
      snap1.length = 0
      expect(c.getSignals()).toHaveLength(1)
    })
  })
})
