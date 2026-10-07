/**
 * GET /agent/runs / /agent/runs/:runId 路由 handler 测试（T5.5）
 * - mock authGuard 注入用户，mock prisma.agentRun
 * - 列表映射 + sessionId 过滤；单条映射 + 不存在 404
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const findMany = vi.fn()
const findFirst = vi.fn()

vi.mock('@pioneering/modu-agent', () => ({
  getConfig: () => ({ get: () => null }),
}))

vi.mock('../src/plugins/auth.js', () => ({
  authGuard: async (req: { user?: unknown }) => {
    req.user = { id: 'user-1' }
  },
}))

import { agentRoutes } from '../src/routes/agent.js'

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify()
  app.decorate('prisma', {
    agentRun: { findMany, findFirst },
  } as never)
  await app.register(agentRoutes)
  return app
}

// run 记录桩（Prisma 形态）
function fakeRun(id: string) {
  return {
    id,
    sessionId: 'sess-1',
    messageId: `msg-for-${id}`,
    agentMode: 'react_agent',
    status: 'completed',
    traceId: id,
    events: [{ seq: 1, type: 'RUN_STARTED', ts: 1 }],
    usage: null,
    errorCode: null,
    errorMessage: null,
    startedAt: new Date(0),
    endedAt: null,
    durationMs: 10,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /agent/runs', () => {
  it('返回当前用户的 run（映射 response）', async () => {
    findMany.mockResolvedValue([fakeRun('run-1'), fakeRun('run-2')])
    const app = await buildServer()

    const r = await app.inject({ method: 'GET', url: '/agent/runs' })

    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({
      runs: [
        { id: 'run-1', messageId: 'msg-for-run-1' },
        { id: 'run-2', messageId: 'msg-for-run-2' },
      ],
    })
    // 强制 userId 隔离
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
      }),
    )
  })

  it('sessionId 过滤 + take 上限', async () => {
    findMany.mockResolvedValue([])
    const app = await buildServer()

    await app.inject({
      method: 'GET',
      url: '/agent/runs?sessionId=sess-1&limit=10',
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', sessionId: 'sess-1' },
        take: 10,
      }),
    )
  })
})

describe('GET /agent/runs/:runId', () => {
  it('返回 run（含事件），按 userId 隔离', async () => {
    findFirst.mockResolvedValue(fakeRun('run-1'))
    const app = await buildServer()

    const r = await app.inject({ method: 'GET', url: '/agent/runs/run-1' })

    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({
      id: 'run-1',
      events: [{ seq: 1, type: 'RUN_STARTED' }],
    })
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'run-1', userId: 'user-1' },
    })
  })

  it('run 不存在（含归属他人）→ 404', async () => {
    findFirst.mockResolvedValue(null)
    const app = await buildServer()

    const r = await app.inject({ method: 'GET', url: '/agent/runs/nope' })

    expect(r.statusCode).toBe(404)
  })
})
