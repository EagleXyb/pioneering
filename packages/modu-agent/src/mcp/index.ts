// 对应 Python: mcp/__init__.py
// MCP (Model Context Protocol) 集成模块。
//
// 提供 MCP Client 连接管理、工具发现、传输层抽象与生命周期管理，
// 使 ModuAgent 能接入外部 MCP Server 获取远程工具。
//
// 公共 API：
//   - MCPClient / getMcpClient / resetMcpClient
//   - MCPSession
//   - ToolInfo / ToolDiscovery
//   - Transport / StdioTransport / SSETransport
//   - MCPError / MCPConnectionError / MCPTimeoutError / MCPToolNotFoundError / MCPProtocolError

// Client
export { MCPClient, MCPSession, getMcpClient, resetMcpClient } from './client.js'
// Discovery
export { ToolInfo, ToolDiscovery } from './discovery.js'
// Transport
export { Transport, StdioTransport, SSETransport } from './transport.js'
// Lifecycle
export { ServerLifecycleManager } from './lifecycle.js'
// Errors
export {
  MCPError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPToolNotFoundError,
  MCPProtocolError,
} from './errors.js'
