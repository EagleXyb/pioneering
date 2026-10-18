/**
 * P5 回归：运行事件缓冲
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { RunEventHub, type RunEvent } from '../src/core/run-events.ts'

let hub: RunEventHub

beforeEach(() => {
  hub = new RunEventHub()
})

describe('RunEventHub', () => {
  it('分配递增 seq，并按 afterSeq 回放', () => {
    hub.start('r1', 'u1')
    expect(hub.publish('r1', 'data: {"type":"A"}\n\n')).toBe(1)
    expect(hub.publish('r1', 'data: {"type":"B"}\n\n')).toBe(2)
    expect(hub.publish('r1', 'data: {"type":"C"}\n\n')).toBe(3)
    hub.finish('r1')

    const sub = hub.subscribe('r1', 1, () => undefined)!
    expect(sub.finished).toBe(true)
    expect(sub.backlog.map((e) => e.seq)).toEqual([2, 3])
  })

  it('运行中订阅：先回放 backlog，再接收实时事件，结束时收到 null', () => {
    hub.start('r2', 'u1')
    hub.publish('r2', 'data: {"type":"A"}\n\n')

    const received: Array<RunEvent | null> = []
    const sub = hub.subscribe('r2', 0, (e) => received.push(e))!
    expect(sub.finished).toBe(false)
    expect(sub.backlog).toHaveLength(1)

    hub.publish('r2', 'data: {"type":"B"}\n\n')
    hub.finish('r2')

    expect(received.map((e) => (e ? e.seq : null))).toEqual([2, null])
  })

  it('owner 校验与不存在运行', () => {
    hub.start('r3', 'u1')
    expect(hub.ownerOf('r3')).toBe('u1')
    expect(hub.ownerOf('missing')).toBeUndefined()
    expect(hub.subscribe('missing', 0, () => undefined)).toBeNull()
  })

  it('结束后不可再 publish', () => {
    hub.start('r4', 'u1')
    hub.finish('r4')
    expect(hub.publish('r4', 'data: x\n\n')).toBeNull()
  })
})
