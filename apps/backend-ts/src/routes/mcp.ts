// MCP 管理路由（T5.1 / T5.2）
//
//   GET  /mcp/servers             列出配置的 MCP servers、连接状态与工具清单
//   POST /mcp/servers             新增一个 MCP server（插件）配置
//   POST /mcp/servers/:name/start 按需连接单个 server
//   POST /mcp/servers/:name/stop  按需断开单个 server
//   GET  /mcp/policy              返回工具审批相关配置
//   PUT  /mcp/policy              更新敏感工具名单 / HITL 开关
//
// 配置来源：modu-agent RuntimeConfig（mcp.servers / mcp.enabled /
// tools.human_in_loop.*）；连接状态：全局 MCPClient 的活动会话。
// 启停后调用 reset_runner_cache()，使下一次 agent 运行按最新 MCP 拓扑重建图。
import { FastifyPluginAsync } from 'fastify'
import {
  getConfig,
  getMcpClient,
  reset_runner_cache,
  MCPConnectionError,
  type MCPSession,
} from '@pioneering/modu-agent'
import { authGuard } from '../plugins/auth.js'

export interface McpToolBrief {
  name: string
  description: string
}

export interface McpServerStatus {
  name: string
  enabled: boolean
  transport: string
  connected: boolean
  toolCount: number
  tools: McpToolBrief[]
}

/** 从活动会话提取工具清单（未连接返回空）。 */
function collectTools(session: MCPSession | undefined): McpToolBrief[] {
  if (!session || !session.connected) return []
  return session.toolsCache.map((t) => ({
    name: t.rawName,
    description: t.description,
  }))
}

/** 支持的 MCP 传输方式（与 MCPClient._createTransport 分支一致）。 */
const ALLOWED_TRANSPORTS = [
  'stdio',
  'sse',
  'streamable_http',
  'websocket',
  'ws',
] as const
type McpTransportName = (typeof ALLOWED_TRANSPORTS)[number]

/**
 * 校验并规范化「添加插件」请求体为 mcp.servers 配置项。
 * 校验失败抛 400（httpError），返回的对象直接写入 runtime config。
 */
function buildServerConfig(body: Record<string, unknown>): {
  name: string
  transport: McpTransportName
  serverCfg: Record<string, unknown>
  autoStart: boolean
} {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw httpError(400, '插件名称不能为空')
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw httpError(400, '插件名称只能包含字母、数字、点、下划线或连字符')
  }

  const transportRaw =
    typeof body.transport === 'string' && body.transport
      ? body.transport
      : 'stdio'
  if (!ALLOWED_TRANSPORTS.includes(transportRaw as McpTransportName)) {
    throw httpError(400, `不支持的传输方式：${transportRaw}`)
  }
  const transport = transportRaw as McpTransportName

  const serverCfg: Record<string, unknown> = { name, transport, enabled: true }

  if (transport === 'stdio') {
    const command = typeof body.command === 'string' ? body.command.trim() : ''
    if (!command) throw httpError(400, 'stdio 传输需要提供启动命令（command）')
    serverCfg.command = command

    if (body.args !== undefined) {
      if (
        !Array.isArray(body.args) ||
        body.args.some((a) => typeof a !== 'string')
      ) {
        throw httpError(400, 'args 必须是字符串数组')
      }
      if (body.args.length > 0) serverCfg.args = body.args
    }

    if (typeof body.cwd === 'string' && body.cwd.trim()) {
      serverCfg.cwd = body.cwd.trim()
    }

    if (body.env !== undefined) {
      if (
        typeof body.env !== 'object' ||
        body.env === null ||
        Array.isArray(body.env) ||
        Object.values(body.env as Record<string, unknown>).some(
          (v) => typeof v !== 'string',
        )
      ) {
        throw httpError(400, 'env 必须是字符串键值对')
      }
      if (Object.keys(body.env as Record<string, unknown>).length > 0) {
        serverCfg.env = body.env
      }
    }
  } else {
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) throw httpError(400, `${transport} 传输需要提供服务地址（url）`)
    serverCfg.url = url
  }

  return { name, transport, serverCfg, autoStart: body.autoStart !== false }
}

/** 构造带 HTTP 状态码的错误（Fastify 默认错误 handler 读取 err.statusCode）。 */
function httpError(
  statusCode: number,
  message: string,
): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number }
  err.statusCode = statusCode
  return err
}

export const mcpRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.register(async (app) => {
    // 所有 MCP 管理端点强制认证（对齐 agent/chat 路由）
    app.addHook('preHandler', authGuard)

    // GET /mcp/servers —— 列出已配置 MCP servers 与连接状态
    app.get(
      '/mcp/servers',
      {
        schema: {
          tags: ['mcp'],
          summary: '列出已配置 MCP servers 与连接状态',
          security: [{ BearerAuth: [] }],
        },
      },
      async () => {
        const config = getConfig()
        const servers =
          (config.get('mcp.servers', []) as Array<Record<string, unknown>>) ??
          []
        const sessions = getMcpClient().sessions

        const serversStatus: McpServerStatus[] = servers.map((cfg) => {
          const name = String(cfg.name ?? '')
          const session = sessions[name]
          const tools = collectTools(session)
          return {
            name,
            enabled: cfg.enabled === false ? false : true,
            transport: String(cfg.transport ?? 'stdio'),
            connected: session?.connected === true,
            toolCount: tools.length,
            tools,
          }
        })

        return { servers: serversStatus, total: serversStatus.length }
      },
    )

    // POST /mcp/servers —— 新增一个 MCP server（插件）配置
    //
    // 写入 RuntimeConfig 内存（对齐 PUT /mcp/policy 的既有口径，不落盘）。
    // autoStart !== false 时立即连接：连接失败不阻断添加（配置已写入），
    // 仅回传 connectError 供前端提示，用户可在插件菜单中重试启用。
    app.post(
      '/mcp/servers',
      {
        schema: {
          tags: ['mcp'],
          summary: '新增 MCP server（插件）',
          security: [{ BearerAuth: [] }],
        },
      },
      async (req) => {
        const body = (req.body ?? {}) as Record<string, unknown>
        const { name, transport, serverCfg, autoStart } = buildServerConfig(body)

        const config = getConfig()
        const servers =
          (config.get('mcp.servers', []) as Array<Record<string, unknown>>) ??
          []
        if (servers.some((s) => String(s?.name) === name)) {
          throw httpError(409, `插件 ${name} 已存在`)
        }

        config.set('mcp.servers', [...servers, serverCfg])
        // 与 start 路由一致：新增插件即打开 MCP 总开关，create_agent 才会发现其工具。
        config.set('mcp.enabled', true)

        let connected = false
        let connectError: string | undefined
        let tools: McpToolBrief[] = []
        if (autoStart) {
          try {
            const session = await getMcpClient().connectServer(config, name)
            connected = session.connected === true
            tools = collectTools(session)
          } catch (e) {
            connectError = e instanceof Error ? e.message : String(e)
          }
        }
        reset_runner_cache()

        return {
          server: {
            name,
            enabled: true,
            transport,
            connected,
            toolCount: tools.length,
            tools,
          },
          ...(connectError ? { connectError } : {}),
        }
      },
    )

    // POST /mcp/servers/:name/start —— 按需连接单个 server
    app.post(
      '/mcp/servers/:name/start',
      {
        schema: {
          tags: ['mcp'],
          summary: '连接指定 MCP server',
          security: [{ BearerAuth: [] }],
        },
      },
      async (req) => {
        const { name } = req.params as { name: string }
        const config = getConfig()
        try {
          // 用户显式启动 server → 打开 MCP 总开关，create_agent 才会发现远程工具。
          config.set('mcp.enabled', true)
          const session = await getMcpClient().connectServer(config, name)
          reset_runner_cache()
          const tools = collectTools(session)
          return { name, connected: true, toolCount: tools.length, tools }
        } catch (e) {
          if (e instanceof MCPConnectionError) {
            const message = e.message ?? String(e)
            // 配置缺失/禁用 → 404；连接或握手失败 → 502。
            const status = /not configured|is disabled/.test(message)
              ? 404
              : 502
            throw httpError(status, message)
          }
          throw httpError(500, e instanceof Error ? e.message : String(e))
        }
      },
    )

    // POST /mcp/servers/:name/stop —— 按需断开单个 server
    app.post(
      '/mcp/servers/:name/stop',
      {
        schema: {
          tags: ['mcp'],
          summary: '断开指定 MCP server',
          security: [{ BearerAuth: [] }],
        },
      },
      async (req) => {
        const { name } = req.params as { name: string }
        await getMcpClient().disconnectServer(name)
        reset_runner_cache()
        return { name, connected: false }
      },
    )

    // GET /mcp/policy —— 返回工具审批相关配置
    app.get(
      '/mcp/policy',
      {
        schema: {
          tags: ['mcp'],
          summary: '查看工具审批策略',
          security: [{ BearerAuth: [] }],
        },
      },
      async () => {
        const config = getConfig()
        return {
          hitlEnabled: Boolean(
            config.get('tools.human_in_loop.enabled', false),
          ),
          sensitiveTools:
            config.get('tools.human_in_loop.sensitive_tools', []) ?? [],
        }
      },
    )

    // PUT /mcp/policy —— 更新敏感工具名单 / HITL 开关
    app.put(
      '/mcp/policy',
      {
        schema: {
          tags: ['mcp'],
          summary: '更新工具审批策略',
          security: [{ BearerAuth: [] }],
        },
      },
      async (req) => {
        const body = (req.body ?? {}) as {
          hitlEnabled?: boolean
          sensitiveTools?: unknown
        }
        const config = getConfig()

        if (typeof body.hitlEnabled === 'boolean') {
          config.set('tools.human_in_loop.enabled', body.hitlEnabled)
        }
        if (body.sensitiveTools !== undefined) {
          if (
            !Array.isArray(body.sensitiveTools) ||
            body.sensitiveTools.some((t) => typeof t !== 'string')
          ) {
            throw httpError(400, 'sensitiveTools 必须是字符串数组')
          }
          config.set(
            'tools.human_in_loop.sensitive_tools',
            body.sensitiveTools,
          )
        }
        reset_runner_cache()

        return {
          hitlEnabled: Boolean(
            config.get('tools.human_in_loop.enabled', false),
          ),
          sensitiveTools:
            config.get('tools.human_in_loop.sensitive_tools', []) ?? [],
        }
      },
    )
  })
}
