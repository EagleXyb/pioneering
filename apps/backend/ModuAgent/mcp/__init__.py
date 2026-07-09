"""MCP (Model Context Protocol) 集成模块。

提供 MCP Client 连接管理、工具发现、传输层抽象与生命周期管理，
使 ModuAgent 能接入外部 MCP Server 获取远程工具。

公共 API：
    - MCPClient / get_mcp_client / reset_mcp_client
    - MCPSession
    - ToolInfo / ToolDiscovery
    - Transport / StdioTransport / SSETransport
    - MCPError / MCPConnectionError / MCPTimeoutError / MCPToolNotFoundError / MCPProtocolError
"""

from __future__ import annotations

from mcp.client import MCPClient, MCPSession, get_mcp_client, reset_mcp_client
from mcp.discovery import ToolDiscovery, ToolInfo
from mcp.errors import (
    MCPConnectionError,
    MCPError,
    MCPProtocolError,
    MCPTimeoutError,
    MCPToolNotFoundError,
)
from mcp.lifecycle import ServerLifecycleManager
from mcp.transport import SSETransport, StdioTransport, Transport

__all__ = [
    # Client
    "MCPClient",
    "MCPSession",
    "get_mcp_client",
    "reset_mcp_client",
    # Discovery
    "ToolInfo",
    "ToolDiscovery",
    # Transport
    "Transport",
    "StdioTransport",
    "SSETransport",
    # Lifecycle
    "ServerLifecycleManager",
    # Errors
    "MCPError",
    "MCPConnectionError",
    "MCPTimeoutError",
    "MCPToolNotFoundError",
    "MCPProtocolError",
]
