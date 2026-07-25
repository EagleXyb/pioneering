// 对应 Python: mcp/client.py
// MCP Client — 多连接管理与会话管理。
//
// 管理到多个 MCP Server 的连接，维护会话状态，提供统一的工具发现和调用入口。
//
// 设计要点：
//   - 一个 MCPClient 实例管理多个 Server 连接
//   - 每个连接对应一个 MCPSession（封装 MCP 协议会话）
//   - 连接池支持复用、超时、自动重连
//   - 异步优先（与 LangGraph 的 astream 一致）
//   - 全局单例（与 ComponentRegistry / RuntimeConfig 风格一致）
//
// 用法：
//   const client = getMcpClient()
//   await client.start(config)             // 启动时连接所有配置的 Server
//   const tools = await client.listAllTools()  // 发现所有 Server 的工具
//   const result = await client.callTool("github__search_repos", { query: "..." })
//   await client.stop()                    // 关闭时断开所有连接

import type { RuntimeConfig } from '../config/runtime-config.js'
import { ToolDiscovery, ToolInfo } from './discovery.js'
import { MCPConnectionError, MCPTimeoutError, MCPToolNotFoundError } from './errors.js'
import { ServerLifecycleManager } from './lifecycle.js'
import { SSETransport, StdioTransport, Transport, WebSocketTransport } from './transport.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[mcp] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[mcp] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[mcp] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[mcp] ${msg}`, ...args),
}

/**
 * 单个 MCP Server 的会话封装。
 *
 * 每个会话对应一个 transport 连接，维护工具缓存和连接状态。
 *
 * 对应 Python MCPSession。
 */
export class MCPSession {
  /** Server 标识（来自配置） */
  serverName: string
  private _transport: Transport
  private _toolsCache: ToolInfo[] = []
  private _connected: boolean = false

  constructor(serverName: string, transport: Transport) {
    this.serverName = serverName
    this._transport = transport
  }

  /**
   * 建立连接并完成 MCP 握手（initialize → initialized）。
   *
   * TS 版的握手由 Transport.connect() 内部通过 SDK Client.connect() 完成。
   *
   * @throws MCPConnectionError 连接或握手失败
   */
  async connect(): Promise<void> {
    if (this._connected) {
      return
    }
    await this._transport.connect()
    this._connected = true
    logger.info('MCP session connected: server=%s', this.serverName)
  }

  /** 断开连接，释放资源。 */
  async disconnect(): Promise<void> {
    if (!this._connected) {
      return
    }
    try {
      await this._transport.disconnect()
    } catch (e) {
      logger.warning("Error disconnecting MCP server '%s': %s", this.serverName, String(e))
    }
    this._connected = false
    this._toolsCache = []
    logger.info('MCP session disconnected: server=%s', this.serverName)
  }

  /**
   * 发现 Server 暴露的工具列表。
   *
   * @param useCache - true 时返回缓存（首次调用后缓存）
   * @returns ToolInfo 列表
   */
  async listTools(useCache: boolean = true): Promise<ToolInfo[]> {
    if (useCache && this._toolsCache.length > 0) {
      return this._toolsCache
    }

    const result = await this._transport.request('tools/list', {})
    const toolsRaw = (result.tools ?? []) as Record<string, any>[]
    this._toolsCache = toolsRaw.map((t) => ToolInfo.fromMcpDict(this.serverName, t))
    logger.info(
      'Discovered %d tools from MCP server %s',
      this._toolsCache.length, this.serverName,
    )
    return this._toolsCache
  }

  /**
   * 调用 MCP Server 上的工具。
   *
   * @param toolName - 工具名（Server 内唯一）
   * @param arguments_ - 工具参数
   * @param timeout - 调用超时（秒）
   * @returns MCP 标准返回格式
   * @throws MCPConnectionError 未连接
   * @throws MCPTimeoutError 调用超时
   */
  async callTool(
    toolName: string,
    arguments_: Record<string, any>,
    timeout: number = 30.0,
  ): Promise<Record<string, any>> {
    if (!this._connected) {
      throw new MCPConnectionError(`Session not connected: ${this.serverName}`)
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(
          new MCPTimeoutError(
            `MCP tool '${toolName}' on server '${this.serverName}' ` +
            `timed out after ${timeout}s`,
          ),
        ),
        timeout * 1000,
      )
    })

    try {
      return await Promise.race([
        this._transport.request('tools/call', {
          name: toolName,
          arguments: arguments_,
        }),
        timeoutPromise,
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** 是否已连接。 */
  get connected(): boolean {
    return this._connected
  }

  /** 工具缓存（供 MCPClient._resolveTool 同步查询）。 */
  get toolsCache(): ToolInfo[] {
    return this._toolsCache
  }
}

/**
 * MCP Client 多连接管理器。
 *
 * 管理到多个 MCP Server 的连接，提供统一的工具发现和调用入口。
 * 设计为单例（与 ComponentRegistry / RuntimeConfig 风格一致）。
 *
 * 对应 Python MCPClient。
 */
export class MCPClient {
  private _sessions: Map<string, MCPSession> = new Map()
  private _discovery: ToolDiscovery = new ToolDiscovery()
  private _lifecycle: ServerLifecycleManager = new ServerLifecycleManager()
  private _started: boolean = false

  /**
   * 根据配置连接所有 MCP Server。
   *
   * @param config - RuntimeConfig 实例
   */
  async start(config: RuntimeConfig): Promise<void> {
    if (this._started) {
      logger.warning('MCPClient already started, skip')
      return
    }

    const serversConfig = (config.get('mcp.servers', []) ?? []) as Record<string, any>[]
    if (!serversConfig || serversConfig.length === 0) {
      logger.info('No MCP servers configured, skipping MCPClient start')
      return
    }

    for (const serverCfg of serversConfig) {
      if (!(serverCfg.enabled ?? true)) {
        logger.debug("MCP server '%s' disabled, skip", serverCfg.name)
        continue
      }
      try {
        const transport = MCPClient._createTransport(serverCfg)
        const session = new MCPSession(serverCfg.name, transport)
        await session.connect()
        this._sessions.set(serverCfg.name, session)

        // 发现工具并缓存
        const tools = await session.listTools(false)
        this._discovery.update(serverCfg.name, tools)

        if (serverCfg.auto_start ?? false) {
          this._lifecycle.track(serverCfg.name)
        }
      } catch (e) {
        logger.error(
          "Failed to connect MCP server '%s': %s",
          serverCfg.name ?? 'unknown', String(e),
        )
        // 单个 Server 失败不阻断其他 Server 连接
      }
    }

    this._started = true
    logger.info(
      'MCPClient started: %d/%d servers connected',
      this._sessions.size, serversConfig.length,
    )
  }

  /** 断开所有连接并停止子进程。 */
  async stop(): Promise<void> {
    for (const [name, session] of [...this._sessions]) {
      try {
        await session.disconnect()
      } catch (e) {
        logger.warning("Error disconnecting MCP server '%s': %s", name, String(e))
      }
    }
    this._sessions.clear()
    this._discovery.clear()
    await this._lifecycle.stopAll()
    this._started = false
    logger.info('MCPClient stopped')
  }

  /**
   * 发现所有已连接 Server 的工具列表。
   *
   * @returns 所有 Server 的工具列表（含 server_name 前缀标识来源）
   */
  async listAllTools(): Promise<ToolInfo[]> {
    const allTools: ToolInfo[] = []
    for (const [name, session] of this._sessions) {
      if (!session.connected) {
        continue
      }
      try {
        const tools = await session.listTools()
        allTools.push(...tools)
      } catch (e) {
        logger.error("Failed to list tools from MCP server '%s': %s", name, String(e))
      }
    }
    return allTools
  }

  /**
   * 调用工具（自动路由到对应 Server）。
   *
   * 工具名格式：`<server_name>__<tool_name>`（双下划线分隔）。
   * 若无分隔符，在所有 Server 中查找。
   *
   * @param toolName - 工具全名（含 server 前缀）或裸名
   * @param arguments_ - 工具参数
   * @param timeout - 调用超时秒
   * @returns MCP 标准返回格式
   * @throws MCPToolNotFoundError 工具未找到
   * @throws MCPConnectionError Server 未连接
   * @throws MCPTimeoutError 调用超时
   */
  async callTool(
    toolName: string,
    arguments_: Record<string, any>,
    timeout: number = 30.0,
  ): Promise<Record<string, any>> {
    const [serverName, rawToolName] = this._resolveTool(toolName)
    const session = this._sessions.get(serverName)
    if (session === undefined || !session.connected) {
      throw new MCPConnectionError(
        `MCP server '${serverName}' not connected for tool '${toolName}'`,
      )
    }
    return await session.callTool(rawToolName, arguments_, timeout)
  }

  /**
   * 解析工具名为 (server_name, raw_tool_name)。
   *
   * 支持两种格式：
   * 1. `server_name__tool_name` → 直接解析
   * 2. `tool_name` → 在所有 Server 中搜索（首个命中）
   *
   * @param toolName - 工具全名或裸名
   * @returns [server_name, raw_tool_name] 元组
   * @throws MCPToolNotFoundError 工具未找到
   */
  private _resolveTool(toolName: string): [string, string] {
    if (toolName.includes('__')) {
      const idx = toolName.indexOf('__')
      return [toolName.slice(0, idx), toolName.slice(idx + 2)]
    }

    // 无前缀：在所有 session 的缓存中搜索
    for (const [name, session] of this._sessions) {
      for (const tool of session.toolsCache) {
        if (tool.rawName === toolName) {
          return [name, toolName]
        }
      }
    }
    throw new MCPToolNotFoundError(
      `Tool '${toolName}' not found in any connected MCP server`,
    )
  }

  /**
   * 根据配置创建传输层实例。
   *
   * @param serverCfg - Server 配置字典
   * @returns Transport 实例
   * @throws ValueError 未知传输类型
   */
  static _createTransport(serverCfg: Record<string, any>): Transport {
    const transportType = serverCfg.transport ?? 'stdio'

    if (transportType === 'stdio') {
      return new StdioTransport(
        serverCfg.command,
        serverCfg.args ?? [],
        serverCfg.env ?? {},
        serverCfg.cwd ?? null,
      )
    } else if (transportType === 'sse' || transportType === 'streamable_http') {
      return new SSETransport(
        serverCfg.url,
        serverCfg.timeout ?? 30.0,
      )
    } else if (transportType === 'websocket' || transportType === 'ws') {
      // v1.2 §4.3 建议11：支持 WebSocket transport
      return new WebSocketTransport(
        serverCfg.url,
        serverCfg.timeout ?? 30.0,
      )
    } else {
      throw new ValueError(`Unknown MCP transport type: ${transportType}`)
    }
  }

  /** 返回所有会话的快照。 */
  get sessions(): Record<string, MCPSession> {
    const result: Record<string, MCPSession> = {}
    for (const [name, session] of this._sessions) {
      result[name] = session
    }
    return result
  }

  /** 是否已启动。 */
  get started(): boolean {
    return this._started
  }

  /** 工具发现服务。 */
  get discovery(): ToolDiscovery {
    return this._discovery
  }
}

/**
 * ValueError — 用于 _createTransport 中未知传输类型。
 *
 * 对应 Python ValueError（内置异常）。
 */
class ValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValueError'
  }
}

// ============================================================
// 全局单例（与 ComponentRegistry / RuntimeConfig 风格一致）
// ============================================================

let _mcpClient: MCPClient | null = null

/**
 * 获取全局 MCPClient 单例。
 *
 * 对应 Python get_mcp_client。
 *
 * @returns MCPClient 实例
 */
export function getMcpClient(): MCPClient {
  if (_mcpClient === null) {
    _mcpClient = new MCPClient()
  }
  return _mcpClient
}

/**
 * 重置单例（测试清理用）。
 *
 * 对应 Python reset_mcp_client。
 */
export function resetMcpClient(): void {
  _mcpClient = null
}
