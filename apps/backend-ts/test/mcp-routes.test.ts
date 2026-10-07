/**
 * MCP 管理路由单元测试（T5.1 / T5.2）
 *
 *   GET  /mcp/servers
 *   POST /mcp/servers/:name/start | stop
 *   GET  /mcp/policy
 *   PUT  /mcp/policy
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MCPConnectionError extends Error {}
  const connectServer = vi.fn()
  const disconnectServer = vi.fn()
  const resetCache = vi.fn()
  const state: {
    servers: Array<Record<string, unknown>>
    sessions: Record<string, { connected: boolean; toolsCache: Array<{ rawName: string; description: string }> }>
    mcpEnabled: boolean
    hitlEnabled: boolean
    sensitiveTools: string[]
  } = {
    servers: [],
    sessions: {},
    mcpEnabled: false,
    hitlEnabled: true,
    sensitiveTools: ['code_executor'],
  }
  return { MCPConnectionError, connectServer, disconnectServer, resetCache, state }
})

vi.mock('@pioneering/modu-agent', () => ({
  MCPConnectionError: mocks.MCPConnectionError,
  reset_runner_cache: mocks.resetCache,
  getConfig: () => ({
    get: (key: string, fallback?: unknown) => {
      switch (key) {
        case 'mcp.servers':
          return mocks.state.servers
        case 'mcp.enabled':
          return mocks.state.mcpEnabled
        case 'tools.human_in_loop.enabled':
          return mocks.state.hitlEnabled
        case 'tools.human_in_loop.sensitive_tools':
          return mocks.state.sensitiveTools
        default:
          return fallback
      }
    },
    set: (key: string, value: unknown) => {
      if (key === 'mcp.enabled') mocks.state.mcpEnabled = value as boolean
      if (key === 'tools.human_in_loop.enabled')
        mocks.state.hitlEnabled = value as boolean
      if (key === 'tools.human_in_loop.sensitive_tools')
        mocks.state.sensitiveTools = value as string[]
    },
  }),
  getMcpClient: () => ({
    get sessions() {
      return mocks.state.sessions
    },
    discovery: { getByServer: () => [] },
    connectServer: mocks.connectServer,
    disconnectServer: mocks.disconnectServer,
  }),
}))

// handler 逻辑测试：mock 认证守卫，直接注入已认证用户（401 强制由 management-auth 覆盖）
vi.mock('../src/plugins/auth.js', () => ({
  authGuard: async (req: { user?: unknown }) => {
    req.user = { id: 'test-user' }
  },
}))

import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import { mcpRoutes } from '../src/routes/mcp.js'

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(mcpRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.servers = []
  mocks.state.sessions = {}
  mocks.state.mcpEnabled = false
  mocks.state.hitlEnabled = true
  mocks.state.sensitiveTools = ['code_executor']
})

describe('GET /mcp/servers', () => {
  it('无配置时返回空列表', async () => {
    const app = await buildServer()
    const reply = await app.inject({ method: 'GET', url: '/mcp/servers' })
    expect(reply.statusCode).toBe(200)
    expect(reply.json()).toEqual({ servers: [], total: 0 })
  })

  it('列出 server、连接状态与已发现工具清单', async () => {
    mocks.state.servers = [
      { name: 'github', transport: 'stdio' },
      { name: 'slack', transport: 'sse', enabled: false },
    ]
    mocks.state.sessions = {
      github: {
        connected: true,
        toolsCache: [{ rawName: 'search_repos', description: '搜仓库' }],
      },
    }

    const app = await buildServer()
    const reply = await app.inject({ method: 'GET', url: '/mcp/servers' })

    expect(reply.json()).toEqual({
      total: 2,
      servers: [
        {
          name: 'github',
          enabled: true,
          transport: 'stdio',
          connected: true,
          toolCount: 1,
          tools: [{ name: 'search_repos', description: '搜仓库' }],
        },
        {
          name: 'slack',
          enabled: false,
          transport: 'sse',
          connected: false,
          toolCount: 0,
          tools: [],
        },
      ],
    })
  })
})

describe('POST /mcp/servers/:name/start', () => {
  it('打开 mcp 总开关、连接 server、失效图缓存并返回工具', async () => {
    const session = {
      connected: true,
      toolsCache: [{ rawName: 'search_repos', description: '搜仓库' }],
    }
    mocks.connectServer.mockResolvedValue(session)

    const app = await buildServer()
    const reply = await app.inject({
      method: 'POST',
      url: '/mcp/servers/github/start',
    })

    expect(reply.statusCode).toBe(200)
    expect(mocks.state.mcpEnabled).toBe(true)
    expect(mocks.connectServer).toHaveBeenCalledTimes(1)
    expect(mocks.resetCache).toHaveBeenCalledTimes(1)
    expect(reply.json()).toEqual({
      name: 'github',
      connected: true,
      toolCount: 1,
      tools: [{ name: 'search_repos', description: '搜仓库' }],
    })
  })

  it('server 未配置（MCPConnectionError）→ 404', async () => {
    mocks.connectServer.mockRejectedValue(
      new mocks.MCPConnectionError(
        "MCP server 'x' is not configured in mcp.servers",
      ),
    )

    const app = await buildServer()
    const reply = await app.inject({
      method: 'POST',
      url: '/mcp/servers/x/start',
    })

    expect(reply.statusCode).toBe(404)
  })

  it('连接/握手失败（MCPConnectionError）→ 502', async () => {
    mocks.connectServer.mockRejectedValue(
      new mocks.MCPConnectionError('MCP connect handshake failed'),
    )

    const app = await buildServer()
    const reply = await app.inject({
      method: 'POST',
      url: '/mcp/servers/github/start',
    })

    expect(reply.statusCode).toBe(502)
  })
})

describe('POST /mcp/servers/:name/stop', () => {
  it('断开 server 并失效图缓存', async () => {
    mocks.disconnectServer.mockResolvedValue(undefined)

    const app = await buildServer()
    const reply = await app.inject({
      method: 'POST',
      url: '/mcp/servers/github/stop',
    })

    expect(reply.statusCode).toBe(200)
    expect(mocks.disconnectServer).toHaveBeenCalledWith('github')
    expect(mocks.resetCache).toHaveBeenCalledTimes(1)
    expect(reply.json()).toEqual({ name: 'github', connected: false })
  })
})

describe('GET /mcp/policy', () => {
  it('返回 HITL 开关与敏感工具名单', async () => {
    const app = await buildServer()
    const reply = await app.inject({ method: 'GET', url: '/mcp/policy' })

    expect(reply.json()).toEqual({
      hitlEnabled: true,
      sensitiveTools: ['code_executor'],
    })
  })
})

describe('PUT /mcp/policy', () => {
  it('更新敏感工具名单并失效图缓存', async () => {
    const app = await buildServer()
    const reply = await app.inject({
      method: 'PUT',
      url: '/mcp/policy',
      payload: { sensitiveTools: ['github__danger'] },
    })

    expect(reply.statusCode).toBe(200)
    expect(mocks.state.sensitiveTools).toEqual(['github__danger'])
    expect(mocks.resetCache).toHaveBeenCalledTimes(1)
    expect(reply.json()).toEqual({
      hitlEnabled: true,
      sensitiveTools: ['github__danger'],
    })
  })

  it('可同时更新 HITL 开关', async () => {
    const app = await buildServer()
    const reply = await app.inject({
      method: 'PUT',
      url: '/mcp/policy',
      payload: { hitlEnabled: false },
    })

    expect(reply.statusCode).toBe(200)
    expect(mocks.state.hitlEnabled).toBe(false)
  })

  it('sensitiveTools 非字符串数组 → 400', async () => {
    const app = await buildServer()
    const reply = await app.inject({
      method: 'PUT',
      url: '/mcp/policy',
      payload: { sensitiveTools: [1, 2] },
    })

    expect(reply.statusCode).toBe(400)
    expect(mocks.resetCache).not.toHaveBeenCalled()
  })
})
