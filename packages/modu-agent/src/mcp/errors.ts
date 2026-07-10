// 对应 Python: mcp/errors.py
// MCP 集成错误码与异常层级。
//
// 与 ModuAgent 现有错误码体系（ErrorCode 常量类）风格一致，
// 使用 `MCP_<NUMBER>` 格式。

/**
 * MCP 集成基础异常。
 *
 * 对应 Python MCPError。
 */
export class MCPError extends Error {
  static error_code = 'MCP_000'

  error_code: string = 'MCP_000'

  constructor(message: string) {
    super(message)
    this.name = 'MCPError'
  }
}

/**
 * 连接 MCP Server 失败或连接已断开。
 *
 * 对应 Python MCPConnectionError。
 */
export class MCPConnectionError extends MCPError {
  static error_code = 'MCP_001'

  error_code: string = 'MCP_001'

  constructor(message: string) {
    super(message)
    this.name = 'MCPConnectionError'
  }
}

/**
 * MCP 工具调用超时。
 *
 * 对应 Python MCPTimeoutError。
 */
export class MCPTimeoutError extends MCPError {
  static error_code = 'MCP_002'

  error_code: string = 'MCP_002'

  constructor(message: string) {
    super(message)
    this.name = 'MCPTimeoutError'
  }
}

/**
 * MCP 工具未在任何已连接 Server 中找到。
 *
 * 对应 Python MCPToolNotFoundError。
 */
export class MCPToolNotFoundError extends MCPError {
  static error_code = 'MCP_003'

  error_code: string = 'MCP_003'

  constructor(message: string) {
    super(message)
    this.name = 'MCPToolNotFoundError'
  }
}

/**
 * MCP 协议错误（JSON-RPC error 响应）。
 *
 * 对应 Python MCPProtocolError。
 */
export class MCPProtocolError extends MCPError {
  static error_code = 'MCP_004'

  error_code: string = 'MCP_004'

  constructor(message: string) {
    super(message)
    this.name = 'MCPProtocolError'
  }
}
