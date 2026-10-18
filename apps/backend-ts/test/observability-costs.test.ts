/**
 * P4 回归：成本汇总接口
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('@pioneering/modu-agent', () => ({
  getConfig: () => ({ get: (_k: string, d: unknown) => d, set: () => undefined }),
  get_metrics_registry: () => ({
    enabled: false,
    collect_text_async: async () => '',
  }),
  reset_metrics_registry: () => undefined,
}))

vi.mock('../src/plugins/auth.js', () => ({
  authGuard: async (req: { user?: unknown }) => {
    req.user = { id: 'u1' }
  },
}))

import { observabilityRoutes } from '../src/routes/observability.js'

const ROWS = [
  {
    userId: 'u1',
    sessionId: 's1',
    model: 'deepseek-v4-flash',
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
    totalTokens: 2_000_000,
  },
  {
    userId: 'u1',
    sessionId: 's2',
    model: 'deepseek-v4-pro',
    promptTokens: 500_000,
    completionTokens: 500_000,
    totalTokens: 1_000_000,
  },
]

async function buildApp() {
  const app = Fastify()
  app.decorate('prisma', {
    tokenUsage: { findMany: async () => ROWS },
  })
  await app.register(observabilityRoutes)
  return app
}

describe('GET /observability/costs', () => {
  it('按模型聚合 token 与成本', async () => {
    const app = await buildApp()
    const reply = await app.inject({
      method: 'GET',
      url: '/observability/costs?days=7&groupBy=model',
    })
    expect(reply.statusCode).toBe(200)

    const body = reply.json()
    expect(body.totals.requests).toBe(2)
    expect(body.totals.totalTokens).toBe(3_000_000)
    // flash: 0.14 + 0.28；pro: 0.14 + 0.28
    expect(body.totals.costUsd).toBeCloseTo(0.84, 6)

    const byKey = Object.fromEntries(
      body.groups.map((g: { key: string }) => [g.key, g]),
    )
    expect(byKey['deepseek-v4-flash'].costUsd).toBeCloseTo(0.42, 6)
    expect(byKey['deepseek-v4-pro'].costUsd).toBeCloseTo(0.42, 6)
  })

  it('按会话聚合', async () => {
    const app = await buildApp()
    const reply = await app.inject({
      method: 'GET',
      url: '/observability/costs?groupBy=session',
    })
    const body = reply.json()
    expect(body.groups.map((g: { key: string }) => g.key).sort()).toEqual(['s1', 's2'])
  })
})
