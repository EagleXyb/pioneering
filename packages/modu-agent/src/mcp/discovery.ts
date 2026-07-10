// 对应 Python: mcp/discovery.py
// MCP 工具发现与缓存。
//
// 从 MCP Server 的 `tools/list` 响应解析工具元信息，
// 提供缓存、查询能力，供 MCPToolAdapter 使用。

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[mcp] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[mcp] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[mcp] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[mcp] ${msg}`, ...args),
}

/**
 * MCP 工具元信息（从 tools/list 响应解析）。
 *
 * 字段对应 MCP 规范的 Tool 定义。
 *
 * 对应 Python ToolInfo dataclass。
 */
export class ToolInfo {
  /** 来源 Server 名 */
  serverName: string
  /** Server 内工具名 */
  rawName: string
  /** 工具描述 */
  description: string
  /** JSON Schema 参数定义 */
  inputSchema: Record<string, any>

  constructor(
    serverName: string,
    rawName: string,
    description: string = '',
    inputSchema: Record<string, any> = {},
  ) {
    this.serverName = serverName
    this.rawName = rawName
    this.description = description
    this.inputSchema = inputSchema
  }

  /** 全限定名：`server_name__raw_name`（避免跨 Server 工具名冲突）。 */
  get qualifiedName(): string {
    return `${this.serverName}__${this.rawName}`
  }

  /**
   * 从 MCP `tools/list` 响应项构建 ToolInfo。
   *
   * 对应 Python ToolInfo.from_mcp_dict。
   *
   * @param serverName - 来源 Server 名
   * @param raw - MCP 响应中的单个工具字典
   * @returns ToolInfo 实例
   */
  static fromMcpDict(serverName: string, raw: Record<string, any>): ToolInfo {
    return new ToolInfo(
      serverName,
      raw.name ?? '',
      raw.description ?? '',
      raw.inputSchema ?? raw.input_schema ?? {},
    )
  }

  /**
   * 转换为 ModuAgent `BaseTool.parametersSchema()` 格式。
   *
   * MCP 的 inputSchema 已是标准 JSON Schema，直接返回即可。
   *
   * 对应 Python ToolInfo.to_base_tool_schema。
   */
  toBaseToolSchema(): Record<string, any> {
    if (this.inputSchema && Object.keys(this.inputSchema).length > 0) {
      return this.inputSchema
    }
    return {
      type: 'object',
      properties: {},
      additionalProperties: true,
    }
  }
}

/**
 * 工具发现服务。
 *
 * 提供工具发现、缓存、查询能力。
 * 由 MCPClient 调用，不直接持有 transport。
 *
 * 对应 Python ToolDiscovery。
 */
export class ToolDiscovery {
  /** server_name → tools */
  private _cache: Map<string, ToolInfo[]> = new Map()

  /**
   * 更新指定 Server 的工具缓存。
   *
   * 对应 Python ToolDiscovery.update。
   */
  update(serverName: string, tools: ToolInfo[]): void {
    this._cache.set(serverName, tools)
    logger.info('Tool cache updated: server=%s, count=%d', serverName, tools.length)
  }

  /**
   * 返回所有缓存工具。
   *
   * 对应 Python ToolDiscovery.get_all。
   */
  getAll(): ToolInfo[] {
    const allTools: ToolInfo[] = []
    for (const tools of this._cache.values()) {
      allTools.push(...tools)
    }
    return allTools
  }

  /**
   * 返回指定 Server 的工具。
   *
   * 对应 Python ToolDiscovery.get_by_server。
   */
  getByServer(serverName: string): ToolInfo[] {
    return this._cache.get(serverName) ?? []
  }

  /**
   * 按全限定名或裸名查找工具。
   *
   * 优先匹配全限定名，其次裸名（首个命中）。
   *
   * 对应 Python ToolDiscovery.find_by_name。
   */
  findByName(toolName: string): ToolInfo | null {
    // 全限定名匹配
    for (const tools of this._cache.values()) {
      for (const tool of tools) {
        if (tool.qualifiedName === toolName) {
          return tool
        }
      }
    }
    // 裸名匹配
    for (const tools of this._cache.values()) {
      for (const tool of tools) {
        if (tool.rawName === toolName) {
          return tool
        }
      }
    }
    return null
  }

  /** 清空缓存。 */
  clear(): void {
    this._cache.clear()
  }
}
