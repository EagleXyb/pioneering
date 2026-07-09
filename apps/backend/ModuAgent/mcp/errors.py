"""MCP 集成错误码与异常层级。

与 ModuAgent 现有错误码体系（ErrorCode 常量类）风格一致，
使用 ``MCP_<NUMBER>`` 格式。
"""

from __future__ import annotations


class MCPError(Exception):
    """MCP 集成基础异常。"""

    error_code = "MCP_000"


class MCPConnectionError(MCPError):
    """连接 MCP Server 失败或连接已断开。"""

    error_code = "MCP_001"


class MCPTimeoutError(MCPError):
    """MCP 工具调用超时。"""

    error_code = "MCP_002"


class MCPToolNotFoundError(MCPError):
    """MCP 工具未在任何已连接 Server 中找到。"""

    error_code = "MCP_003"


class MCPProtocolError(MCPError):
    """MCP 协议错误（JSON-RPC error 响应）。"""

    error_code = "MCP_004"
