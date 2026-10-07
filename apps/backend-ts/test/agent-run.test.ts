/**
 * T5.5：agent_run 落库与事件时间轴测试
 * - collectRunTimeline：里程碑收录 / CONTENT 折叠 / 截断 / 上限
 * - startAgentRun / finishAgentRun：create / update 数据与终态推导
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  StreamContext,
  collectRunTimeline,
  startAgentRun,
  finishAgentRun,
} from '../src/core/agent-bridge.js'

// prisma 桩
const created: any[] = []
const updated: any[] = []
const prisma = {
  agentRun: {
    create: vi.fn(async ({ data }: { data: any }) => {
      created.push(data)
    }),
    update: vi.fn(async ({ where, data }: { where: any; data: any }) => {
      updated.push({ where, data })
    }),
  },
}

/** 构造 AG-UI 事件 dict */
function eventDict(type: string, extra: Record<string, any> = {}): { data: string } {
  return { data: JSON.stringify({ type, ...extra }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  created.length = 0
  updated.length = 0
})

describe('startAgentRun', () => {
  it('创建 running 记录，traceId=runId，默认 react_agent', async () => {
    await startAgentRun(prisma, {
      runId: 'run-1',
      sessionId: 'sess-1',
      userId: 'user-1',
    })

    expect(prisma.agentRun.create).toHaveBeenCalledTimes(1)
    expect(created[0]).toMatchObject({
      id: 'run-1',
      sessionId: 'sess-1',
      userId: 'user-1',
      status: 'running',
      traceId: 'run-1',
      agentMode: 'react_agent',
    })
    expect(created[0].startedAt).toBeInstanceOf(Date)
  })
})

describe('collectRunTimeline', () => {
  it('收录工具里程碑（名称/参数），折叠 TEXT_CONTENT 分片', () => {
    const ctx = new StreamContext()

    collectRunTimeline(
      eventDict('TOOL_CALL_START', {
        toolCallId: 'c1',
        toolCallName: 'search_engine',
        toolCallArgs: { q: 'x' },
      }),
      ctx,
    )
    collectRunTimeline(eventDict('TEXT_MESSAGE_CONTENT', { delta: 'a' }), ctx)
    collectRunTimeline(eventDict('TEXT_MESSAGE_CONTENT', { delta: 'b' }), ctx)
    collectRunTimeline(
      eventDict('TOOL_CALL_RESULT', { content: 'ok' }),
      ctx,
    )

    expect(ctx.runEvents).toHaveLength(2)
    expect(ctx.runEvents[0]).toMatchObject({
      seq: 1,
      type: 'TOOL_CALL_START',
      toolCallName: 'search_engine',
      toolCallArgs: '{"q":"x"}',
    })
    expect(ctx.runEvents[1].type).toBe('TOOL_CALL_RESULT')
  })

  it('超长结构化参数截断并加省略标记', () => {
    const ctx = new StreamContext()
    const longArgs = { text: 'x'.repeat(500) }
    collectRunTimeline(
      eventDict('TOOL_CALL_START', { toolCallName: 't', toolCallArgs: longArgs }),
      ctx,
    )

    const s = ctx.runEvents[0].toolCallArgs as string
    expect(s.length).toBeLessThanOrEqual(301)
    expect(s.endsWith('…')).toBe(true)
  })

  it('达 300 上限后不再追加', () => {
    const ctx = new StreamContext()
    for (let i = 0; i < 305; i++) {
      collectRunTimeline(eventDict('STEP_FINISHED', { content: `s${i}` }), ctx)
    }
    expect(ctx.runEvents).toHaveLength(300)
  })

  it('非法 JSON / 无 type 安全跳过', () => {
    const ctx = new StreamContext()
    collectRunTimeline({ data: 'not-json' }, ctx)
    collectRunTimeline({ data: JSON.stringify({ foo: 1 }) }, ctx)
    expect(ctx.runEvents).toHaveLength(0)
  })
})

describe('finishAgentRun：终态推导', () => {
  it('成功完成 → completed，带 endedAt/usage/events', async () => {
    const ctx = new StreamContext()
    ctx.latencyMs = 120
    collectRunTimeline(eventDict('RUN_FINISHED'), ctx)

    await finishAgentRun(prisma, { runId: 'run-1', ctx })

    const data = updated[0].data
    expect(data.status).toBe('completed')
    expect(data.endedAt).toBeInstanceOf(Date)
    expect(data.durationMs).toBe(120)
    expect(data.usage).toEqual({ promptTokens: 0, completionTokens: 0 })
    expect(data.events).toHaveLength(1)
  })

  it('ctx.hasError → error 且带错误码', async () => {
    const ctx = new StreamContext()
    ctx.hasError = true
    ctx.errorInfo = { code: 'AGENT_ERROR', message: 'boom' }

    await finishAgentRun(prisma, { runId: 'run-1', ctx })

    expect(updated[0].data.status).toBe('error')
    expect(updated[0].data.errorCode).toBe('AGENT_ERROR')
    expect(updated[0].data.errorMessage).toBe('boom')
  })

  it('runPaused → paused，不写 endedAt（等待 resume）', async () => {
    const ctx = new StreamContext()
    ctx.runPaused = true
    ctx.paused = true

    await finishAgentRun(prisma, { runId: 'run-1', ctx })

    const data = updated[0].data
    expect(data.status).toBe('paused')
    expect(data.endedAt).toBeUndefined()
  })

  it('abortReason → cancelled', async () => {
    const ctx = new StreamContext()
    ctx.abortReason = 'user_cancel'

    await finishAgentRun(prisma, { runId: 'run-1', ctx })

    expect(updated[0].data.status).toBe('cancelled')
  })

  it('baseEvents：resume 段与首次事件合并、seq 延续', async () => {
    const ctx = new StreamContext()
    collectRunTimeline(eventDict('RUN_FINISHED'), ctx)
    const base = [{ seq: 1, type: 'RUN_STARTED', ts: 1 }]

    await finishAgentRun(prisma, {
      runId: 'run-1',
      ctx,
      baseEvents: base,
    })

    const events = updated[0].data.events
    expect(events.map((e: any) => e.type)).toEqual([
      'RUN_STARTED',
      'RUN_FINISHED',
    ])
    expect(events[1].seq).toBe(2)
  })
})
