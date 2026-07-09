"""MCP Client — 多连接管理与会话管理。

管理到多个 MCP Server 的连接，维护会话状态，提供统一的工具发现和调用入口。

设计要点：
    - 一个 MCPClient 实例管理多个 Server 连接
    - 每个连接对应一个 MCPSession（封装 MCP 协议会话）
    - 连接池支持复用、超时、自动重连
    - 异步优先（与 LangGraph 的 astream 一致）
    - 全局单例（与 ComponentRegistry / RuntimeConfig 风格一致）

用法::

    client = get_mcp_client()
    await client.start(config)             # 启动时连接所有配置的 Server
    tools = await client.list_all_tools()  # 发现所有 Server 的工具
    result = await client.call_tool("github__search_repos", {"query": "..."})
    await client.stop()                    # 关闭时断开所有连接
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

from mcp.discovery import ToolDiscovery, ToolInfo
from mcp.errors import MCPConnectionError, MCPTimeoutError, MCPToolNotFoundError
from mcp.lifecycle import ServerLifecycleManager
from mcp.transport import SSETransport, StdioTransport, Transport

logger = logging.getLogger(__name__)


class MCPSession:
    """单个 MCP Server 的会话封装。

    每个会话对应一个 transport 连接，维护工具缓存和连接状态。

    Attributes:
        server_name: Server 标识（来自配置）
    """

    def __init__(self, server_name: str, transport: Transport) -> None:
        self.server_name = server_name
        self._transport = transport
        self._tools_cache: List[ToolInfo] = []
        self._connected: bool = False
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        """建立连接并完成 MCP 握手（initialize → initialized）。

        Raises:
            MCPConnectionError: 连接或握手失败
        """
        async with self._lock:
            if self._connected:
                return
            await self._transport.connect()
            # MCP 协议握手：initialize → send "initialized" notification
            await self._transport.request("initialize", {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "moduagent", "version": "0.1.0"},
            })
            await self._transport.notify("notifications/initialized", {})
            self._connected = True
            logger.info("MCP session connected: server=%s", self.server_name)

    async def disconnect(self) -> None:
        """断开连接，释放资源。"""
        async with self._lock:
            if not self._connected:
                return
            try:
                await self._transport.disconnect()
            except Exception as e:  # noqa: BLE001
                logger.warning("Error disconnecting MCP server '%s': %s", self.server_name, e)
            self._connected = False
            self._tools_cache.clear()
            logger.info("MCP session disconnected: server=%s", self.server_name)

    async def list_tools(self, use_cache: bool = True) -> List[ToolInfo]:
        """发现 Server 暴露的工具列表。

        Args:
            use_cache: True 时返回缓存（首次调用后缓存）

        Returns:
            ToolInfo 列表
        """
        if use_cache and self._tools_cache:
            return self._tools_cache

        async with self._lock:
            result = await self._transport.request("tools/list", {})
            tools_raw = result.get("tools", [])
            self._tools_cache = [
                ToolInfo.from_mcp_dict(self.server_name, t) for t in tools_raw
            ]
            logger.info(
                "Discovered %d tools from MCP server '%s'",
                len(self._tools_cache), self.server_name,
            )
            return self._tools_cache

    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        timeout: float = 30.0,
    ) -> Dict[str, Any]:
        """调用 MCP Server 上的工具。

        Args:
            tool_name: 工具名（Server 内唯一）
            arguments: 工具参数
            timeout: 调用超时（秒）

        Returns:
            MCP 标准返回格式

        Raises:
            MCPConnectionError: 未连接
            MCPTimeoutError: 调用超时
        """
        if not self._connected:
            raise MCPConnectionError(f"Session not connected: {self.server_name}")

        try:
            result = await asyncio.wait_for(
                self._transport.request("tools/call", {
                    "name": tool_name,
                    "arguments": arguments,
                }),
                timeout=timeout,
            )
            return result
        except asyncio.TimeoutError as e:
            raise MCPTimeoutError(
                f"MCP tool '{tool_name}' on server '{self.server_name}' "
                f"timed out after {timeout}s"
            ) from e

    @property
    def connected(self) -> bool:
        """是否已连接。"""
        return self._connected


class MCPClient:
    """MCP Client 多连接管理器。

    管理到多个 MCP Server 的连接，提供统一的工具发现和调用入口。
    设计为单例（与 ComponentRegistry / RuntimeConfig 风格一致）。
    """

    def __init__(self) -> None:
        self._sessions: Dict[str, MCPSession] = {}
        self._discovery = ToolDiscovery()
        self._lifecycle = ServerLifecycleManager()
        self._started: bool = False

    async def start(self, config: Any) -> None:
        """根据配置连接所有 MCP Server。

        Args:
            config: RuntimeConfig 实例
        """
        if self._started:
            logger.warning("MCPClient already started, skip")
            return

        servers_config = config.get("mcp.servers", []) or []
        if not servers_config:
            logger.info("No MCP servers configured, skipping MCPClient start")
            return

        for server_cfg in servers_config:
            if not server_cfg.get("enabled", True):
                logger.debug("MCP server '%s' disabled, skip", server_cfg.get("name"))
                continue
            try:
                transport = self._create_transport(server_cfg)
                session = MCPSession(server_cfg["name"], transport)
                await session.connect()
                self._sessions[server_cfg["name"]] = session

                # 发现工具并缓存
                tools = await session.list_tools(use_cache=False)
                self._discovery.update(server_cfg["name"], tools)

                if server_cfg.get("auto_start", False):
                    self._lifecycle.track(server_cfg["name"])
            except Exception as e:  # noqa: BLE001
                logger.error(
                    "Failed to connect MCP server '%s': %s",
                    server_cfg.get("name", "unknown"), e,
                )
                # 单个 Server 失败不阻断其他 Server 连接

        self._started = True
        logger.info(
            "MCPClient started: %d/%d servers connected",
            len(self._sessions), len(servers_config),
        )

    async def stop(self) -> None:
        """断开所有连接并停止子进程。"""
        for name, session in list(self._sessions.items()):
            try:
                await session.disconnect()
            except Exception as e:  # noqa: BLE001
                logger.warning("Error disconnecting MCP server '%s': %s", name, e)
        self._sessions.clear()
        self._discovery.clear()
        await self._lifecycle.stop_all()
        self._started = False
        logger.info("MCPClient stopped")

    async def list_all_tools(self) -> List[ToolInfo]:
        """发现所有已连接 Server 的工具列表。

        Returns:
            所有 Server 的工具列表（含 server_name 前缀标识来源）
        """
        all_tools: List[ToolInfo] = []
        for name, session in self._sessions.items():
            if not session.connected:
                continue
            try:
                tools = await session.list_tools()
                all_tools.extend(tools)
            except Exception as e:  # noqa: BLE001
                logger.error("Failed to list tools from MCP server '%s': %s", name, e)
        return all_tools

    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        timeout: float = 30.0,
    ) -> Dict[str, Any]:
        """调用工具（自动路由到对应 Server）。

        工具名格式：``<server_name>__<tool_name>``（双下划线分隔）。
        若无分隔符，在所有 Server 中查找。

        Args:
            tool_name: 工具全名（含 server 前缀）或裸名
            arguments: 工具参数
            timeout: 调用超时秒

        Returns:
            MCP 标准返回格式

        Raises:
            MCPToolNotFoundError: 工具未找到
            MCPConnectionError: Server 未连接
            MCPTimeoutError: 调用超时
        """
        server_name, raw_tool_name = self._resolve_tool(tool_name)
        session = self._sessions.get(server_name)
        if session is None or not session.connected:
            raise MCPConnectionError(
                f"MCP server '{server_name}' not connected for tool '{tool_name}'"
            )
        return await session.call_tool(raw_tool_name, arguments, timeout=timeout)

    def _resolve_tool(self, tool_name: str) -> Tuple[str, str]:
        """解析工具名为 (server_name, raw_tool_name)。

        支持两种格式：
        1. ``server_name__tool_name`` → 直接解析
        2. ``tool_name`` → 在所有 Server 中搜索（首个命中）

        Args:
            tool_name: 工具全名或裸名

        Returns:
            (server_name, raw_tool_name) 元组

        Raises:
            MCPToolNotFoundError: 工具未找到
        """
        if "__" in tool_name:
            parts = tool_name.split("__", 1)
            return parts[0], parts[1]

        # 无前缀：在所有 session 的缓存中搜索
        for name, session in self._sessions.items():
            for tool in session._tools_cache:
                if tool.raw_name == tool_name:
                    return name, tool_name
        raise MCPToolNotFoundError(
            f"Tool '{tool_name}' not found in any connected MCP server"
        )

    @staticmethod
    def _create_transport(server_cfg: Dict[str, Any]) -> Transport:
        """根据配置创建传输层实例。

        Args:
            server_cfg: Server 配置字典

        Returns:
            Transport 实例

        Raises:
            ValueError: 未知传输类型
        """
        transport_type = server_cfg.get("transport", "stdio")

        if transport_type == "stdio":
            return StdioTransport(
                command=server_cfg["command"],
                args=server_cfg.get("args", []),
                env=server_cfg.get("env", {}),
                cwd=server_cfg.get("cwd"),
            )
        elif transport_type in ("sse", "streamable_http"):
            return SSETransport(
                url=server_cfg["url"],
                timeout=server_cfg.get("timeout", 30.0),
            )
        else:
            raise ValueError(f"Unknown MCP transport type: {transport_type}")

    @property
    def sessions(self) -> Dict[str, MCPSession]:
        """返回所有会话的快照。"""
        return dict(self._sessions)

    @property
    def started(self) -> bool:
        """是否已启动。"""
        return self._started

    @property
    def discovery(self) -> ToolDiscovery:
        """工具发现服务。"""
        return self._discovery


# ============================================================
# 全局单例（与 ComponentRegistry / RuntimeConfig 风格一致）
# ============================================================

_mcp_client: Optional[MCPClient] = None


def get_mcp_client() -> MCPClient:
    """获取全局 MCPClient 单例。

    Returns:
        MCPClient 实例
    """
    global _mcp_client
    if _mcp_client is None:
        _mcp_client = MCPClient()
    return _mcp_client


def reset_mcp_client() -> None:
    """重置单例（测试清理用）。"""
    global _mcp_client
    _mcp_client = None
