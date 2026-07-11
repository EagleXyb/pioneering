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
})
