/**
 * P0 认证强制回归（T5.2 / T5.4）
*
* 使用**真实 authGuard**（不 mock plugins/auth），仅 mock modu-agent 让 handler 可控，
* 通过 Fastify decorate 注入 prisma。验证：
*   - 各管理端点无 / 非法 / 过期令牌 → 401，且在 handler 之前强制
*   - 有效令牌但用户不存在 → 401
*   - 有效令牌 + 用户存在 → 放行到 handler（200）
*/
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'

// mock modu-agent（真实 authGuard 仍来自 plugins/auth.js）
vi.mock('@pioneering/modu-agent', () => ({
  getConfig: () => ({
    get: (key: string, fallback?: unknown) => {
      if (key === 'mcp.servers') return []
      if (key === 'mcp.enabled') return false
      return fallback
    },
    set: () => undefined,
  }),
  getMcpClient: () => ({ sessions: {} }),
  get_metrics_registry: () => ({ enabled: false }),
  reset_metrics_registry: vi.fn(),
  reset_runner_cache: vi.fn(),
  MCPConnectionError: class extends Error {},
}))

import { mcpRoutes } from '../src/routes/mcp.js'
import { observabilityRoutes } from '../src/routes/observability.js'
import { agentRoutes } from '../src/routes/agent.js'
import { createAccessToken } from '../src/core/security.js'

// prisma 桩：可控 findUnique
const findUnique = vi.fn()
const fakePrisma = { user: { findUnique } }

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify()
  app.decorate('prisma', fakePrisma as never)
  await app.register(mcpRoutes)
  await app.register(observabilityRoutes)
  await app.register(agentRoutes)
  return app
}

// register 作用域内 addHook 对所有子路由生效——参数化代表路径（含读/写/启停）
const PROTECTED: ReadonlyArray<{ method: 'GET' | 'PUT' | 'POST'; url: string }> = [
  { method: 'GET', url: '/mcp/servers' },
  { method: 'GET', url: '/mcp/policy' },
  { method: 'PUT', url: '/mcp/policy' },
  { method: 'POST', url: '/mcp/servers/x/start' },
  { method: 'POST', url: '/mcp/servers/x/stop' },
  { method: 'GET', url: '/observability/settings' },
  { method: 'PUT', url: '/observability/settings' },
  // metrics：无 token 必须 401（而不是配置关闭的 503），证明认证先于 handler
  { method: 'GET', url: '/observability/metrics' },
  // runs：列表 / 单条（agentRoutes 带 /agent prefix）
  { method: 'GET', url: '/agent/runs' },
  { method: 'GET', url: '/agent/runs/run-x' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('P0 · 管理端点认证强制', () => {
  it('完全无 Authorization 头 → 401 缺少认证令牌（handler 未执行）', async () => {
    const app = await buildServer()
    for (const p of PROTECTED) {
      const r = await app.inject({ method: p.method, url: p.url, payload: {} })
      expect(r.statusCode, `${p.method} ${p.url}`).toBe(401)
      expect(r.json()?.message).toContain('认证令牌')
    }
    // handler 依赖（prisma 等）从未被触碰
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('非 Bearer 前缀 → 401', async () => {
    const app = await buildServer()
    const r = await app.inject({
      method: 'GET',
      url: '/mcp/servers',
      headers: { authorization: 'Basic abc' },
    })
    expect(r.statusCode).toBe(401)
  })

  it('Bearer 令牌签名无效 → 401 令牌无效或已过期', async () => {
    const app = await buildServer()
    const r = await app.inject({
      method: 'GET',
      url: '/mcp/servers',
      headers: { authorization: 'Bearer not-a-valid-jwt' },
    })
    expect(r.statusCode).toBe(401)
    expect(r.json()?.message).toContain('无效或已过期')
  })

  it('有效令牌但用户不存在 → 401 用户不存在', async () => {
    findUnique.mockResolvedValue(null)
    const token = createAccessToken('ghost-user')
    const app = await buildServer()
    const r = await app.inject({
      method: 'GET',
      url: '/mcp/servers',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(r.statusCode).toBe(401)
    expect(r.json()?.message).toContain('用户不存在')
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'ghost-user' } })
  })

  it('有效令牌 + 用户存在 → 放行到 handler（200）', async () => {
    findUnique.mockResolvedValue({ id: 'user-1', username: 'alice' })
    const token = createAccessToken('user-1')
    const app = await buildServer()
    const r = await app.inject({
      method: 'GET',
      url: '/mcp/servers',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(r.statusCode).toBe(200)
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } })
  })
})
