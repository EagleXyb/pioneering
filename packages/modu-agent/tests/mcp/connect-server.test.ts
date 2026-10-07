// T5.2：MCPClient 单 server 按需启停（connectServer / disconnectServer）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { MCPClient, MCPSession } from '@/mcp/client.js'
import { Transport } from '@/mcp/transport.js'
import { RuntimeConfig } from '@/config/runtime-config.js'
import { MCPConnectionError } from '@/mcp/errors.js'

/** 返回固定工具清单的桩传输（不拉起真实进程/连接）。 */
class StubTransport extends Transport {
  private _connected = false
  private readonly tools: Array<Record<string, any>>

  constructor(
    tools: Array<Record<string, any>> = [
      { name: 'search', description: '搜索', inputSchema: {} },
    ],
  ) {
    super()
    this.tools = tools
  }

  async connect(): Promise<void> {
    this._connected = true
  }
  async disconnect(): Promise<void> {
    this._connected = false
  }
  async request(method: string): Promise<Record<string, any>> {
    if (method === 'tools/list') return { tools: this.tools }
    return {}
  }
  async notify(): Promise<void> {}
  get connected(): boolean {
    return this._connected
  }
}

function makeConfig(servers: Array<Record<string, any>>): RuntimeConfig {
  return new RuntimeConfig({ mcp: { enabled: false, servers } })
}

describe('T5.2 · MCPClient.connectServer', () => {
  let createSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    createSpy = vi
      .spyOn(MCPClient, '_createTransport')
      .mockImplementation(() => new StubTransport())
  })
  afterEach(() => {
    createSpy.mockRestore()
  })

  it('连接已配置 server：会话活动、工具入发现缓存、started=true', async () => {
    const client = new MCPClient()
    const config = makeConfig([{ name: 'github', transport: 'stdio' }])

    const session = await client.connectServer(config, 'github')

    expect(session).toBeInstanceOf(MCPSession)
    expect(session.connected).toBe(true)
    expect(client.started).toBe(true)
    expect(session.toolsCache.map((t) => t.rawName)).toEqual(['search'])
    expect(client.discovery.getByServer('github')).toHaveLength(1)
  })

  it('未在 mcp.servers 配置 → 抛 MCPConnectionError', async () => {
    const client = new MCPClient()
    const config = makeConfig([{ name: 'github', transport: 'stdio' }])

    await expect(
      client.connectServer(config, 'unknown'),
    ).rejects.toBeInstanceOf(MCPConnectionError)
    expect(client.started).toBe(false)
  })

  it('server enabled:false → 抛 MCPConnectionError，不连接', async () => {
    const client = new MCPClient()
    const config = makeConfig([
      { name: 'github', transport: 'stdio', enabled: false },
    ])

    await expect(
      client.connectServer(config, 'github'),
    ).rejects.toBeInstanceOf(MCPConnectionError)
    expect(client.sessions.github).toBeUndefined()
  })

  it('已连接时幂等：不重复创建传输/握手', async () => {
    const client = new MCPClient()
    const config = makeConfig([{ name: 'github', transport: 'stdio' }])

    const first = await client.connectServer(config, 'github')
    const second = await client.connectServer(config, 'github')

    expect(second).toBe(first)
    expect(createSpy).toHaveBeenCalledTimes(1)
  })
})

describe('T5.2 · MCPClient.disconnectServer', () => {
  beforeEach(() => {
    vi.spyOn(MCPClient, '_createTransport').mockImplementation(
      () => new StubTransport(),
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function connectAll(
    servers: Array<Record<string, any>>,
  ): Promise<MCPClient> {
    const client = new MCPClient()
    const config = makeConfig(servers)
    for (const s of servers) {
      await client.connectServer(config, String(s.name))
    }
    return client
  }

  it('断开后移除会话与发现缓存；无剩余连接时 started=false', async () => {
    const client = await connectAll([{ name: 'github', transport: 'stdio' }])

    await client.disconnectServer('github')

    expect(client.sessions.github).toBeUndefined()
    expect(client.discovery.getByServer('github')).toEqual([])
    expect(client.started).toBe(false)
  })

  it('仍有其他连接时 started 保持 true，全部断开后为 false', async () => {
    const client = await connectAll([
      { name: 'github', transport: 'stdio' },
      { name: 'slack', transport: 'sse' },
    ])

    await client.disconnectServer('github')
    expect(client.started).toBe(true)
    expect(client.sessions.slack.connected).toBe(true)

    await client.disconnectServer('slack')
    expect(client.started).toBe(false)
  })

  it('断开未连接的 server 不抛错', async () => {
    const client = new MCPClient()
    await expect(
      client.disconnectServer('ghost'),
    ).resolves.toBeUndefined()
  })

  it('断开后删除缓存配置，阻止后续 callTool 懒重连', async () => {
    const client = await connectAll([{ name: 'github', transport: 'stdio' }])

    await client.disconnectServer('github')

    expect((client as any)._serverConfigs.has('github')).toBe(false)
  })
})
