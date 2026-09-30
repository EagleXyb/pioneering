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

describe('P0-7 · 全局订阅者与域级订阅者合流', () => {
  it('同 domain 全局+域级订阅者共存：各收到且仅收到一次', async () => {
    const bus = new EventBus()
    const globalHandler = vi.fn()
    const domainHandler = vi.fn()
    bus.subscribe(globalHandler)           // 无 domain（如 PersistentEventLog）
    bus.subscribe(domainHandler, 'audit')  // 域级

    await bus.publish(makeEvent('audit', 'record'))

    expect(globalHandler).toHaveBeenCalledTimes(1)
    expect(domainHandler).toHaveBeenCalledTimes(1)
  })

  it('全局订阅者接收任意 domain 的事件（即使该 domain 存在域级订阅者）', async () => {
    const bus = new EventBus()
    const globalHandler = vi.fn()
    bus.subscribe(globalHandler)
    bus.subscribe(vi.fn(), 'domain-a')
    bus.subscribe(vi.fn(), 'domain-b')

    await bus.publish(makeEvent('domain-a', 'x'))
    await bus.publish(makeEvent('domain-b', 'x'))
    await bus.publish(makeEvent('domain-c', 'x'))

    expect(globalHandler).toHaveBeenCalledTimes(3)
  })

  it('回归原缺陷场景：request 响应窗口内，全局审计订阅者不被跳过', async () => {
    const bus = new EventBus()
    const auditHandler = vi.fn()
    bus.subscribe(auditHandler) // 无域订阅（PersistentEventLog 形态）

    // request() 会为 domain 注册一个域级响应处理器——
    // 旧实现此后该 domain 的事件只走域索引，审计日志被完全跳过。
    // action 过滤为 'query'：响应器只响应请求事件，不对 *_response 自我触发
    bus.subscribe(async (ev: AgentEvent) => {
      const resp = new AgentEvent({
        user_id: 'u1',
        session_id: 's1',
        domain: ev.domain,
        action: `${ev.action}_response`,
        metadata: { request_id: ev.event_id },
      })
      await bus.publish(resp)
    }, 'reasoning', 'query')

    const resp = await bus.request(makeEvent('reasoning', 'query'), 1000)
    expect(resp).not.toBeNull()
    // 请求事件与响应事件都必须送达全局订阅者（各 1 次，共 2 次）
    expect(auditHandler).toHaveBeenCalledTimes(2)
  })

  it('全局订阅者取消后不再接收；不影响域级订阅者', async () => {
    const bus = new EventBus()
    const globalHandler = vi.fn()
    const domainHandler = vi.fn()
    const unsubGlobal = bus.subscribe(globalHandler)
    bus.subscribe(domainHandler, 'audit')

    unsubGlobal()
    await bus.publish(makeEvent('audit', 'record'))

    expect(globalHandler).not.toHaveBeenCalled()
    expect(domainHandler).toHaveBeenCalledTimes(1)
  })

  it('其他 domain 的域级订阅者不收到本域事件（行为不回归）', async () => {
    const bus = new EventBus()
    const aHandler = vi.fn()
    bus.subscribe(aHandler, 'domain-a')
    await bus.publish(makeEvent('domain-b', 'x'))
    expect(aHandler).not.toHaveBeenCalled()
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
