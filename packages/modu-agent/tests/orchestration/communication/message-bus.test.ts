import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '@/orchestration/communication/message-bus.js'
import { AgentEvent, EventDomain, EventAction, EventPriority } from '@/orchestration/communication/protocol.js'

function makeEvent(domain: string, action: string, priority: string = EventPriority.NORMAL): AgentEvent {
  return new AgentEvent({
    user_id: 'u1',
    session_id: 's1',
    domain,
    action,
    priority: priority as any,
  })
}

describe('EventBus', () => {
  it('delivers published events to subscribers', async () => {
    const bus = new EventBus()
    const handler = vi.fn()
    bus.subscribe(handler)
    await bus.publish(makeEvent('reasoning', 'generate'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('filters by domain', async () => {
    const bus = new EventBus()
    const handler = vi.fn()
    bus.subscribe(handler, 'memory')
    await bus.publish(makeEvent('reasoning', 'generate'))
    await bus.publish(makeEvent('memory', 'query'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('filters by priority', async () => {
    const bus = new EventBus()
    const handler = vi.fn()
    bus.subscribe(handler, null, null, EventPriority.HIGH)
    await bus.publish(makeEvent('reasoning', 'generate', EventPriority.NORMAL))
    await bus.publish(makeEvent('reasoning', 'generate', EventPriority.HIGH))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops delivery', async () => {
    const bus = new EventBus()
    const handler = vi.fn()
    const unsub = bus.subscribe(handler)
    await bus.publish(makeEvent('reasoning', 'generate'))
    unsub()
    await bus.publish(makeEvent('reasoning', 'generate'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('supports request/response correlation', async () => {
    const bus = new EventBus()
    // 响应处理器需按 domain 订阅，否则会被 publish 的 domain 索引路径跳过
    bus.subscribe(async (ev: AgentEvent) => {
      const resp = new AgentEvent({
        user_id: 'u1',
        session_id: 's1',
        domain: ev.domain,
        action: `${ev.action}_response`,
        metadata: { request_id: ev.event_id },
      })
      await bus.publish(resp)
    }, 'reasoning')
    const req = makeEvent('reasoning', 'query')
    const resp = await bus.request(req, 1000)
    expect(resp).not.toBeNull()
    expect(resp!.action).toBe('query_response')
  })
})

describe('AgentEvent', () => {
  it('requires user_id, session_id, domain and action', () => {
    expect(
      () => new AgentEvent({ user_id: 'u', session_id: 's', domain: 'd' } as any),
    ).toThrow()
  })

  it('round-trips through toDict/fromDict', () => {
    const ev = makeEvent('memory', 'query')
    const back = AgentEvent.fromDict(ev.toDict())
    expect(back.domain).toBe('memory')
    expect(back.action).toBe('query')
    expect(back.event_id).toBe(ev.event_id)
  })

  it('exposes domain/action/priority constants', () => {
    expect(EventDomain.REASONING).toBe('reasoning')
    expect(EventAction.GENERATE).toBe('generate')
    expect(EventPriority.CRITICAL).toBe('critical')
  })
})
