// P1-19：无会话上下文的成本事件以 unknown 哨兵成功发布（旧实现被 protocol 校验静默丢弃）。
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { EventBus, get_event_bus } from '@/orchestration/communication/message-bus.js'
import { publish_llm_cost_event } from '@/reasoning/llm/cost-tracker.js'
import { resetConfig } from '@/config/runtime-config.js'

beforeEach(() => {
  resetConfig()
})

describe('P1-19 · publish_llm_cost_event 无会话哨兵', () => {
  it('无 sessionId/userId：事件仍发布，二者均为 unknown 哨兵', async () => {
    const bus = new EventBus()
    get_event_bus(bus)
    const received: any[] = []
    bus.subscribe((e) => {
      received.push(e)
    })

    await publish_llm_cost_event(
      { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      { provider: 'openai', model: 'gpt-test' },
    )

    expect(received).toHaveLength(1)
    expect(received[0].session_id).toBe('unknown')
    expect(received[0].user_id).toBe('unknown')
    expect(received[0].payload.usage.total_tokens).toBe(15)
  })

  it('有 sessionId 时原样透传', async () => {
    const bus = new EventBus()
    get_event_bus(bus)
    const received: any[] = []
    bus.subscribe((e) => received.push(e))

    await publish_llm_cost_event(
      { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      { provider: 'p', model: 'm', sessionId: 'sess-xyz', userId: 'u-9' },
    )
    expect(received[0].session_id).toBe('sess-xyz')
    expect(received[0].user_id).toBe('u-9')
  })

  it('total_tokens=0 不发布（既有短路语义不回归）', async () => {
    const bus = new EventBus()
    get_event_bus(bus)
    const spy = vi.fn()
    bus.subscribe(spy)
    await publish_llm_cost_event(
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      { provider: 'p', model: 'm' },
    )
    expect(spy).not.toHaveBeenCalled()
  })
})
