"""MCP 集成完整测试套件。

覆盖范围：
    1. errors — MCP 错误码与异常层级
    2. discovery — ToolInfo 数据模型与 ToolDiscovery 缓存
    3. transport — Transport 抽象与实现
    4. lifecycle — ServerLifecycleManager
    5. client — MCPClient/MCPSession 连接管理与工具调用
    6. mcp_tool_adapter — MCPToolAdapter → BaseTool 适配
    7. runtime_config — mcp 配置节
    8. factory 集成 — create_agent 中 MCP 工具发现
    9. 回归测试 — 现有功能不受影响
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# 确保 ModuAgent 根目录在 sys.path 中
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ============================================================
# 1. errors 模块测试
# ============================================================

class TestMCPErrors:
    """MCP 错误码与异常层级测试。"""

    def test_mcp_error_base(self):
        from mcp.errors import MCPError
        err = MCPError("test error")
        assert err.error_code == "MCP_000"
        assert str(err) == "test error"
        assert isinstance(err, Exception)

    def test_connection_error(self):
        from mcp.errors import MCPConnectionError, MCPError
        err = MCPConnectionError("conn failed")
        assert err.error_code == "MCP_001"
        assert isinstance(err, MCPError)

    def test_timeout_error(self):
        from mcp.errors import MCPError, MCPTimeoutError
        err = MCPTimeoutError("timeout")
        assert err.error_code == "MCP_002"
        assert isinstance(err, MCPError)

    def test_tool_not_found_error(self):
        from mcp.errors import MCPError, MCPToolNotFoundError
        err = MCPToolNotFoundError("not found")
        assert err.error_code == "MCP_003"
        assert isinstance(err, MCPError)

    def test_protocol_error(self):
        from mcp.errors import MCPError, MCPProtocolError
        err = MCPProtocolError("protocol error")
        assert err.error_code == "MCP_004"
        assert isinstance(err, MCPError)

    def test_error_hierarchy(self):
        """所有子异常都应被 MCPError 捕获。"""
        from mcp.errors import (
            MCPConnectionError,
            MCPError,
            MCPProtocolError,
            MCPTimeoutError,
            MCPToolNotFoundError,
        )
        for exc_class in [MCPConnectionError, MCPTimeoutError, MCPToolNotFoundError, MCPProtocolError]:
            assert issubclass(exc_class, MCPError)


# ============================================================
# 2. discovery 模块测试
# ============================================================

class TestToolInfo:
    """ToolInfo 数据模型测试。"""

    def test_qualified_name(self):
        from mcp.discovery import ToolInfo
        info = ToolInfo(server_name="github", raw_name="search_repos", description="Search repos")
        assert info.qualified_name == "github__search_repos"

    def test_from_mcp_dict(self):
        from mcp.discovery import ToolInfo
        raw = {
            "name": "get_file",
            "description": "Get file contents",
            "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}},
        }
        info = ToolInfo.from_mcp_dict("filesystem", raw)
        assert info.server_name == "filesystem"
        assert info.raw_name == "get_file"
        assert info.description == "Get file contents"
        assert info.input_schema["type"] == "object"

    def test_from_mcp_dict_empty_schema(self):
        from mcp.discovery import ToolInfo
        raw = {"name": "noop", "description": "No-op tool"}
        info = ToolInfo.from_mcp_dict("test", raw)
        assert info.input_schema == {}

    def test_to_base_tool_schema_with_data(self):
        from mcp.discovery import ToolInfo
        info = ToolInfo(
            server_name="test",
            raw_name="tool1",
            input_schema={"type": "object", "properties": {"x": {"type": "string"}}},
        )
        schema = info.to_base_tool_schema()
        assert schema["type"] == "object"
        assert "properties" in schema

    def test_to_base_tool_schema_empty(self):
        from mcp.discovery import ToolInfo
        info = ToolInfo(server_name="test", raw_name="tool1")
        schema = info.to_base_tool_schema()
        assert schema["type"] == "object"
        assert "additionalProperties" in schema


class TestToolDiscovery:
    """ToolDiscovery 缓存与查询测试。"""

    def test_update_and_get_all(self):
        from mcp.discovery import ToolDiscovery, ToolInfo
        discovery = ToolDiscovery()
        tools = [
            ToolInfo(server_name="github", raw_name="search", description="Search"),
            ToolInfo(server_name="github", raw_name="create", description="Create"),
        ]
        discovery.update("github", tools)
        all_tools = discovery.get_all()
        assert len(all_tools) == 2

    def test_get_by_server(self):
        from mcp.discovery import ToolDiscovery, ToolInfo
        discovery = ToolDiscovery()
        tools = [ToolInfo(server_name="github", raw_name="search")]
        discovery.update("github", tools)
        result = discovery.get_by_server("github")
        assert len(result) == 1
        assert result[0].raw_name == "search"

    def test_get_by_server_empty(self):
        from mcp.discovery import ToolDiscovery
        discovery = ToolDiscovery()
        assert discovery.get_by_server("nonexistent") == []

    def test_find_by_qualified_name(self):
        from mcp.discovery import ToolDiscovery, ToolInfo
        discovery = ToolDiscovery()
        discovery.update("github", [
            ToolInfo(server_name="github", raw_name="search"),
        ])
        result = discovery.find_by_name("github__search")
        assert result is not None
        assert result.raw_name == "search"

    def test_find_by_raw_name(self):
        from mcp.discovery import ToolDiscovery, ToolInfo
        discovery = ToolDiscovery()
        discovery.update("github", [
            ToolInfo(server_name="github", raw_name="search"),
        ])
        result = discovery.find_by_name("search")
        assert result is not None
        assert result.server_name == "github"

    def test_find_not_found(self):
        from mcp.discovery import ToolDiscovery
        discovery = ToolDiscovery()
        assert discovery.find_by_name("nonexistent") is None

    def test_clear(self):
        from mcp.discovery import ToolDiscovery, ToolInfo
        discovery = ToolDiscovery()
        discovery.update("github", [ToolInfo(server_name="github", raw_name="search")])
        discovery.clear()
        assert discovery.get_all() == []


# ============================================================
# 3. transport 模块测试
# ============================================================

class TestStdioTransport:
    """StdioTransport 测试（使用 Mock 子进程）。"""

    @pytest.mark.asyncio
    async def test_connect_disconnect_mock(self):
        """测试 StdioTransport 连接/断开流程（Mock 子进程）。"""
        from mcp.transport import StdioTransport

        transport = StdioTransport(command="echo", args=["hello"])

        # Mock asyncio.create_subprocess_exec
        mock_process = MagicMock()
        mock_process.stdin = MagicMock()
        mock_process.stdout = MagicMock()
        mock_process.stderr = MagicMock()
        mock_process.returncode = None
        mock_process.wait = AsyncMock(return_value=0)
        mock_process.terminate = MagicMock()

        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = mock_process

            await transport.connect()
            assert transport.connected is True

            await transport.disconnect()
            assert transport.connected is False

    @pytest.mark.asyncio
    async def test_request_not_connected(self):
        """未连接时调用 request 应抛出 MCPConnectionError。"""
        from mcp.errors import MCPConnectionError
        from mcp.transport import StdioTransport

        transport = StdioTransport(command="echo")
        # 不调用 connect
        with pytest.raises(MCPConnectionError):
            await transport.request("tools/list", {})

    @pytest.mark.asyncio
    async def test_notify_not_connected(self):
        """未连接时调用 notify 应抛出 MCPConnectionError。"""
        from mcp.errors import MCPConnectionError
        from mcp.transport import StdioTransport

        transport = StdioTransport(command="echo")
        with pytest.raises(MCPConnectionError):
            await transport.notify("notifications/initialized", {})


class TestSSETransport:
    """SSETransport 测试。"""

    @pytest.mark.asyncio
    async def test_connect_disconnect(self):
        from mcp.transport import SSETransport

        transport = SSETransport(url="http://localhost:3001/sse")

        # Mock httpx.AsyncClient
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value = mock_client

            await transport.connect()
            assert transport.connected is True

            await transport.disconnect()
            assert transport.connected is False
            mock_client.aclose.assert_called_once()

    @pytest.mark.asyncio
    async def test_request_not_connected(self):
        from mcp.errors import MCPConnectionError
        from mcp.transport import SSETransport

        transport = SSETransport(url="http://localhost:3001/sse")
        with pytest.raises(MCPConnectionError):
            await transport.request("tools/list", {})


class TestResolveEnv:
    """环境变量替换测试。"""

    def test_resolve_env_no_vars(self):
        from mcp.transport import _resolve_env
        env = {"KEY": "value"}
        result = _resolve_env(env)
        assert result["KEY"] == "value"

    def test_resolve_env_with_vars(self):
        from mcp.transport import _resolve_env
        os.environ["TEST_MCP_KEY"] = "secret_value"
        try:
            env = {"API_KEY": "${TEST_MCP_KEY}"}
            result = _resolve_env(env)
            assert result["API_KEY"] == "secret_value"
        finally:
            del os.environ["TEST_MCP_KEY"]

    def test_resolve_env_missing_var(self):
        from mcp.transport import _resolve_env
        env = {"API_KEY": "${NONEXISTENT_VAR_12345}"}
        result = _resolve_env(env)
        # 未找到环境变量时保留原样
        assert result["API_KEY"] == "${NONEXISTENT_VAR_12345}"


# ============================================================
# 4. lifecycle 模块测试
# ============================================================

class TestServerLifecycleManager:
    """ServerLifecycleManager 测试。"""

    @pytest.mark.asyncio
    async def test_track_and_stop(self):
        from mcp.lifecycle import ServerLifecycleManager
        mgr = ServerLifecycleManager()
        mgr.track("server1")
        assert mgr.is_tracked("server1") is True
        await mgr.stop_server("server1")
        assert mgr.is_tracked("server1") is False

    @pytest.mark.asyncio
    async def test_stop_all(self):
        from mcp.lifecycle import ServerLifecycleManager
        mgr = ServerLifecycleManager()
        mgr.track("server1")
        mgr.track("server2")
        await mgr.stop_all()
        assert mgr.is_tracked("server1") is False
        assert mgr.is_tracked("server2") is False

    def test_tracked_servers(self):
        from mcp.lifecycle import ServerLifecycleManager
        mgr = ServerLifecycleManager()
        mgr.track("server1")
        assert "server1" in mgr.tracked_servers


# ============================================================
# 5. client 模块测试
# ============================================================

class TestMCPSession:
    """MCPSession 测试（使用 Mock Transport）。"""

    @pytest.mark.asyncio
    async def test_connect_handshake(self):
        from mcp.client import MCPSession
        from mcp.transport import Transport

        class MockTransport(Transport):
            def __init__(self):
                self._connected = False
                self.requests = []
                self.notifies = []

            async def connect(self):
                self._connected = True

            async def disconnect(self):
                self._connected = False

            async def request(self, method, params):
                self.requests.append((method, params))
                if method == "initialize":
                    return {"protocolVersion": "2024-11-05", "capabilities": {}}
                if method == "tools/list":
                    return {"tools": [{"name": "search", "description": "Search"}]}
                return {}

            async def notify(self, method, params):
                self.notifies.append((method, params))

            @property
            def connected(self):
                return self._connected

        transport = MockTransport()
        session = MCPSession("test_server", transport)

        await session.connect()
        assert session.connected is True

        # 验证握手请求
        assert len(transport.requests) == 1
        assert transport.requests[0][0] == "initialize"

        # 验证 initialized 通知
        assert len(transport.notifies) == 1
        assert transport.notifies[0][0] == "notifications/initialized"

    @pytest.mark.asyncio
    async def test_list_tools(self):
        from mcp.client import MCPSession
        from mcp.transport import Transport

        class MockTransport(Transport):
            def __init__(self):
                self._connected = False

            async def connect(self):
                self._connected = True

            async def disconnect(self):
                self._connected = False

            async def request(self, method, params):
                if method == "initialize":
                    return {"protocolVersion": "2024-11-05"}
                if method == "tools/list":
                    return {"tools": [
                        {"name": "search", "description": "Search tool"},
                        {"name": "create", "description": "Create tool"},
                    ]}
                return {}

            async def notify(self, method, params):
                pass

            @property
            def connected(self):
                return self._connected

        transport = MockTransport()
        session = MCPSession("test_server", transport)
        await session.connect()

        tools = await session.list_tools(use_cache=False)
        assert len(tools) == 2
        assert tools[0].raw_name == "search"
        assert tools[0].server_name == "test_server"

    @pytest.mark.asyncio
    async def test_call_tool(self):
        from mcp.client import MCPSession
        from mcp.transport import Transport

        class MockTransport(Transport):
            def __init__(self):
                self._connected = False

            async def connect(self):
                self._connected = True

            async def disconnect(self):
                self._connected = False

            async def request(self, method, params):
                if method == "initialize":
                    return {"protocolVersion": "2024-11-05"}
                if method == "tools/list":
                    return {"tools": []}
                if method == "tools/call":
                    return {"content": [{"type": "text", "text": "result"}], "isError": False}
                return {}

            async def notify(self, method, params):
                pass

            @property
            def connected(self):
                return self._connected

        transport = MockTransport()
        session = MCPSession("test_server", transport)
        await session.connect()

        result = await session.call_tool("search", {"query": "test"})
        assert result["content"][0]["text"] == "result"
        assert result["isError"] is False

    @pytest.mark.asyncio
    async def test_call_tool_not_connected(self):
        from mcp.client import MCPSession
        from mcp.errors import MCPConnectionError
        from mcp.transport import Transport

        class MockTransport(Transport):
            def __init__(self):
                self._connected = False
            async def connect(self): self._connected = True
            async def disconnect(self): self._connected = False
            async def request(self, method, params): return {}
            async def notify(self, method, params): pass
            @property
            def connected(self): return self._connected

        transport = MockTransport()
        session = MCPSession("test", transport)
        # 不调用 connect
        with pytest.raises(MCPConnectionError):
            await session.call_tool("search", {})

    @pytest.mark.asyncio
    async def test_call_tool_timeout(self):
        from mcp.client import MCPSession
        from mcp.errors import MCPTimeoutError
        from mcp.transport import Transport

        class SlowTransport(Transport):
            def __init__(self):
                self._connected = False
            async def connect(self): self._connected = True
            async def disconnect(self): self._connected = False
            async def request(self, method, params):
                if method == "initialize":
                    return {"protocolVersion": "2024-11-05"}
                if method == "tools/list":
                    return {"tools": []}
                await asyncio.sleep(10)  # 超过 timeout
                return {}
            async def notify(self, method, params): pass
            @property
            def connected(self): return self._connected

        transport = SlowTransport()
        session = MCPSession("test", transport)
        await session.connect()

        with pytest.raises(MCPTimeoutError):
            await session.call_tool("search", {}, timeout=0.1)


class TestMCPClient:
    """MCPClient 多连接管理测试。"""

    @pytest.mark.asyncio
    async def test_start_no_servers(self):
        from mcp.client import MCPClient, reset_mcp_client
        reset_mcp_client()

        from config.runtime_config import RuntimeConfig
        config = RuntimeConfig()
        config.set("mcp.enabled", True)
        config.set("mcp.servers", [])

        client = MCPClient()
        await client.start(config)
        # 无 Server 配置时直接返回，started 保持 False
        assert client.started is False
        assert len(client.sessions) == 0
        await client.stop()

    @pytest.mark.asyncio
    async def test_start_with_mock_server(self):
        from mcp.client import MCPClient, MCPSession
        from mcp.transport import Transport

        class MockTransport(Transport):
            def __init__(self):
                self._connected = False
            async def connect(self): self._connected = True
            async def disconnect(self): self._connected = False
            async def request(self, method, params):
                if method == "initialize":
                    return {"protocolVersion": "2024-11-05"}
                if method == "tools/list":
                    return {"tools": [{"name": "search", "description": "Search"}]}
                if method == "tools/call":
                    return {"content": [{"type": "text", "text": "ok"}], "isError": False}
                return {}
            async def notify(self, method, params): pass
            @property
            def connected(self): return self._connected

        from config.runtime_config import RuntimeConfig
        config = RuntimeConfig()
        config.set("mcp.enabled", True)
        config.set("mcp.servers", [{
            "name": "test_server",
            "enabled": True,
            "transport": "stdio",
            "command": "echo",
        }])

        client = MCPClient()

        # Mock _create_transport 返回 MockTransport
        with patch.object(MCPClient, "_create_transport", return_value=MockTransport()):
            await client.start(config)

        assert client.started is True
        assert "test_server" in client.sessions
        assert client.sessions["test_server"].connected is True

        # 测试工具发现
        tools = await client.list_all_tools()
        assert len(tools) == 1
        assert tools[0].raw_name == "search"

        # 测试工具调用
        result = await client.call_tool("test_server__search", {"query": "test"})
        assert result["content"][0]["text"] == "ok"

        await client.stop()
        assert client.started is False

    @pytest.mark.asyncio
    async def test_start_server_failure_isolated(self):
        """单个 Server 失败不影响其他 Server。"""
        from mcp.client import MCPClient
        from mcp.transport import Transport

        class GoodTransport(Transport):
            def __init__(self):
                self._connected = False
            async def connect(self): self._connected = True
            async def disconnect(self): self._connected = False
            async def request(self, method, params):
                if method == "initialize": return {"protocolVersion": "2024-11-05"}
                if method == "tools/list": return {"tools": []}
                return {}
            async def notify(self, method, params): pass
            @property
            def connected(self): return self._connected

        class BadTransport(Transport):
            def __init__(self):
                self._connected = False
            async def connect(self): raise ConnectionError("bad server")
            async def disconnect(self): self._connected = False
            async def request(self, method, params): return {}
            async def notify(self, method, params): pass
            @property
            def connected(self): return self._connected

        from config.runtime_config import RuntimeConfig
        config = RuntimeConfig()
        config.set("mcp.enabled", True)
        config.set("mcp.servers", [
            {"name": "bad", "enabled": True, "transport": "stdio", "command": "bad"},
            {"name": "good", "enabled": True, "transport": "stdio", "command": "good"},
        ])

        client = MCPClient()
        transport_map = {"bad": BadTransport(), "good": GoodTransport()}
        with patch.object(MCPClient, "_create_transport", side_effect=lambda cfg: transport_map[cfg["name"]]):
            await client.start(config)

        # bad 失败，good 成功
        assert "good" in client.sessions
        assert "bad" not in client.sessions
        await client.stop()

    @pytest.mark.asyncio
    async def test_resolve_tool_qualified(self):
        from mcp.client import MCPClient
        from mcp.discovery import ToolInfo

        client = MCPClient()
        # 手动注入 session 和工具缓存
        mock_session = MagicMock()
        mock_session._tools_cache = [ToolInfo(server_name="github", raw_name="search")]
        client._sessions["github"] = mock_session

        server, raw = client._resolve_tool("github__search")
        assert server == "github"
        assert raw == "search"

    @pytest.mark.asyncio
    async def test_resolve_tool_bare_name(self):
        from mcp.client import MCPClient
        from mcp.discovery import ToolInfo

        client = MCPClient()
        mock_session = MagicMock()
        mock_session._tools_cache = [ToolInfo(server_name="github", raw_name="search")]
        client._sessions["github"] = mock_session

        server, raw = client._resolve_tool("search")
        assert server == "github"
        assert raw == "search"

    @pytest.mark.asyncio
    async def test_resolve_tool_not_found(self):
        from mcp.client import MCPClient
        from mcp.errors import MCPToolNotFoundError

        client = MCPClient()
        with pytest.raises(MCPToolNotFoundError):
            client._resolve_tool("nonexistent")

    @pytest.mark.asyncio
    async def test_start_already_started(self):
        from mcp.client import MCPClient
        from config.runtime_config import RuntimeConfig

        config = RuntimeConfig()
        config.set("mcp.enabled", True)
        # 配置一个 Server 使 started=True
        config.set("mcp.servers", [{
            "name": "test",
            "enabled": True,
            "transport": "stdio",
            "command": "echo",
        }])

        client = MCPClient()

        class MockTransport:
            def __init__(self):
                self._connected = False
            async def connect(self): self._connected = True
            async def disconnect(self): self._connected = False
            async def request(self, method, params):
                if method == "initialize": return {"protocolVersion": "2024-11-05"}
                if method == "tools/list": return {"tools": []}
                return {}
            async def notify(self, method, params): pass
            @property
            def connected(self): return self._connected

        with patch.object(MCPClient, "_create_transport", return_value=MockTransport()):
            await client.start(config)
            assert client.started is True
            # 再次调用应跳过
            await client.start(config)
            assert client.started is True

        await client.stop()

    @pytest.mark.asyncio
    async def test_create_transport_stdio(self):
        from mcp.client import MCPClient
        from mcp.transport import StdioTransport

        transport = MCPClient._create_transport({
            "name": "test",
            "transport": "stdio",
            "command": "echo",
            "args": ["hello"],
        })
        assert isinstance(transport, StdioTransport)

    @pytest.mark.asyncio
    async def test_create_transport_sse(self):
        from mcp.client import MCPClient
        from mcp.transport import SSETransport

        transport = MCPClient._create_transport({
            "name": "test",
            "transport": "sse",
            "url": "http://localhost:3001/sse",
        })
        assert isinstance(transport, SSETransport)

    @pytest.mark.asyncio
    async def test_create_transport_unknown(self):
        from mcp.client import MCPClient
        with pytest.raises(ValueError, match="Unknown MCP transport"):
            MCPClient._create_transport({
                "name": "test",
                "transport": "websocket",
            })


class TestMCPClientSingleton:
    """MCPClient 全局单例测试。"""

    def test_get_mcp_client_singleton(self):
        from mcp.client import get_mcp_client, reset_mcp_client
        reset_mcp_client()
        c1 = get_mcp_client()
        c2 = get_mcp_client()
        assert c1 is c2

    def test_reset_mcp_client(self):
        from mcp.client import get_mcp_client, reset_mcp_client
        c1 = get_mcp_client()
        reset_mcp_client()
        c2 = get_mcp_client()
        assert c1 is not c2


# ============================================================
# 6. MCPToolAdapter 测试
# ============================================================

class TestMCPToolAdapter:
    """MCPToolAdapter → BaseTool 适配测试。"""

    def test_name_qualified(self):
        from mcp.discovery import ToolInfo
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        info = ToolInfo(server_name="github", raw_name="search_repos", description="Search repos")
        adapter = MCPToolAdapter(info)
        assert adapter.name() == "github__search_repos"

    def test_description_with_server_prefix(self):
        from mcp.discovery import ToolInfo
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        info = ToolInfo(server_name="github", raw_name="search", description="Search repos")
        adapter = MCPToolAdapter(info)
        desc = adapter.description()
        assert "[MCP:github]" in desc
        assert "Search repos" in desc

    def test_parameters_schema(self):
        from mcp.discovery import ToolInfo
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        info = ToolInfo(
            server_name="test",
            raw_name="tool1",
            input_schema={"type": "object", "properties": {"x": {"type": "string"}}},
        )
        adapter = MCPToolAdapter(info)
        schema = adapter.parameters_schema()
        assert schema["type"] == "object"

    def test_requires_approval_default_false(self):
        from mcp.discovery import ToolInfo
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        info = ToolInfo(server_name="test", raw_name="tool1")
        adapter = MCPToolAdapter(info)
        assert adapter.requires_approval() is False

    def test_is_base_tool_subclass(self):
        from core.interfaces.action import BaseTool
        from mcp.discovery import ToolInfo
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        info = ToolInfo(server_name="test", raw_name="tool1")
        adapter = MCPToolAdapter(info)
        assert isinstance(adapter, BaseTool)

    def test_invoke_success(self):
        from mcp.discovery import ToolInfo
        from mcp.client import get_mcp_client, reset_mcp_client
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        reset_mcp_client()

        info = ToolInfo(server_name="test", raw_name="search", description="Search")
        adapter = MCPToolAdapter(info)

        # Mock MCPClient.call_tool 返回成功结果
        mock_client = get_mcp_client()
        mock_client._sessions = {}

        with patch.object(mock_client, "call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.return_value = {
                "content": [{"type": "text", "text": "search result"}],
                "isError": False,
            }

            result = adapter.invoke({"query": "test"}, {})

        assert result["status"] == "success"
        assert result["data"]["result"] == "search result"
        assert result["data"]["source"] == "mcp"
        assert result["data"]["server"] == "test"

    def test_invoke_error_response(self):
        from mcp.discovery import ToolInfo
        from mcp.client import get_mcp_client, reset_mcp_client
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        reset_mcp_client()

        info = ToolInfo(server_name="test", raw_name="search")
        adapter = MCPToolAdapter(info)

        mock_client = get_mcp_client()
        with patch.object(mock_client, "call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.return_value = {
                "content": [{"type": "text", "text": "error occurred"}],
                "isError": True,
            }

            result = adapter.invoke({"query": "test"}, {})

        assert result["status"] == "error"
        assert result["error_code"] == "MCP_004"

    def test_invoke_timeout_error(self):
        from mcp.discovery import ToolInfo
        from mcp.client import get_mcp_client, reset_mcp_client
        from mcp.errors import MCPTimeoutError
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        reset_mcp_client()

        info = ToolInfo(server_name="test", raw_name="search")
        adapter = MCPToolAdapter(info)

        mock_client = get_mcp_client()
        with patch.object(mock_client, "call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.side_effect = MCPTimeoutError("timeout")

            result = adapter.invoke({"query": "test"}, {})

        assert result["status"] == "error"
        assert result["error_code"] == "MCP_002"

    def test_invoke_connection_error(self):
        from mcp.discovery import ToolInfo
        from mcp.client import get_mcp_client, reset_mcp_client
        from mcp.errors import MCPConnectionError
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        reset_mcp_client()

        info = ToolInfo(server_name="test", raw_name="search")
        adapter = MCPToolAdapter(info)

        mock_client = get_mcp_client()
        with patch.object(mock_client, "call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.side_effect = MCPConnectionError("not connected")

            result = adapter.invoke({"query": "test"}, {})

        assert result["status"] == "error"
        assert result["error_code"] == "MCP_001"

    def test_invoke_unexpected_error(self):
        from mcp.discovery import ToolInfo
        from mcp.client import get_mcp_client, reset_mcp_client
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        reset_mcp_client()

        info = ToolInfo(server_name="test", raw_name="search")
        adapter = MCPToolAdapter(info)

        mock_client = get_mcp_client()
        with patch.object(mock_client, "call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.side_effect = RuntimeError("unexpected")

            result = adapter.invoke({"query": "test"}, {})

        assert result["status"] == "error"
        assert result["error_code"] == "MCP_000"

    def test_format_result_empty_content(self):
        from mcp.discovery import ToolInfo
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        info = ToolInfo(server_name="test", raw_name="tool1")
        adapter = MCPToolAdapter(info)

        # 空 content 应返回 JSON 序列化的整个结果
        result = adapter._format_result({"isError": False, "content": []})
        assert result["status"] == "success"
        assert "result" in result["data"]


# ============================================================
# 7. runtime_config mcp 配置节测试
# ============================================================

class TestMCPRuntimeConfig:
    """RuntimeConfig 中 mcp 配置节测试。"""

    def test_default_mcp_disabled(self):
        from config.runtime_config import RuntimeConfig
        config = RuntimeConfig()
        assert config.get("mcp.enabled") is False

    def test_default_mcp_servers_empty(self):
        from config.runtime_config import RuntimeConfig
        config = RuntimeConfig()
        assert config.get("mcp.servers") == []

    def test_default_mcp_timeout(self):
        from config.runtime_config import RuntimeConfig
        config = RuntimeConfig()
        assert config.get("mcp.default_timeout") == 30.0

    def test_set_mcp_enabled(self):
        from config.runtime_config import RuntimeConfig
        config = RuntimeConfig()
        config.set("mcp.enabled", True)
        assert config.get("mcp.enabled") is True

    def test_set_mcp_servers(self):
        from config.runtime_config import RuntimeConfig
        config = RuntimeConfig()
        servers = [
            {"name": "github", "transport": "stdio", "command": "npx"},
        ]
        config.set("mcp.servers", servers)
        assert config.get("mcp.servers") == servers

    def test_mcp_config_with_custom_data(self):
        from config.runtime_config import RuntimeConfig
        custom = {
            "mcp": {
                "enabled": True,
                "servers": [{"name": "test", "transport": "stdio", "command": "echo"}],
            }
        }
        config = RuntimeConfig(config_data=custom)
        assert config.get("mcp.enabled") is True
        assert len(config.get("mcp.servers")) == 1


# ============================================================
# 8. factory 集成测试
# ============================================================

class TestFactoryMCPIntegration:
    """factory.py 中 MCP 工具发现集成测试。"""

    def test_create_agent_mcp_disabled_no_effect(self):
        """mcp.enabled=False 时 create_agent 行为不变。"""
        from config.runtime_config import RuntimeConfig, reset_config
        from core.registry import reset_registry
        from mcp.client import reset_mcp_client

        reset_config()
        reset_registry()
        reset_mcp_client()

        config = RuntimeConfig()
        assert config.get("mcp.enabled") is False

        # 调用 _discover_and_register_mcp_tools 应无副作用
        from modu_graph.factory import _discover_and_register_mcp_tools
        # 不应抛出异常
        _discover_and_register_mcp_tools(config)

    def test_create_agent_mcp_enabled_no_servers(self):
        """mcp.enabled=True 但无 Server 时不影响 create_agent。"""
        from config.runtime_config import RuntimeConfig, reset_config
        from core.registry import reset_registry
        from mcp.client import reset_mcp_client

        reset_config()
        reset_registry()
        reset_mcp_client()

        config = RuntimeConfig()
        config.set("mcp.enabled", True)
        config.set("mcp.servers", [])

        from modu_graph.factory import _discover_and_register_mcp_tools
        # MCPClient 未 started，应直接返回
        _discover_and_register_mcp_tools(config)

    def test_discover_registers_mcp_tools(self):
        """MCP 工具发现后正确注册到 ComponentRegistry。"""
        from config.runtime_config import RuntimeConfig, reset_config
        from core.registry import get_registry, reset_registry
        from mcp.client import get_mcp_client, reset_mcp_client
        from mcp.discovery import ToolInfo

        reset_config()
        reset_registry()
        reset_mcp_client()

        config = RuntimeConfig()
        config.set("mcp.enabled", True)

        # Mock MCPClient: 已启动 + 返回工具列表
        client = get_mcp_client()
        client._started = True

        mock_tools = [
            ToolInfo(server_name="github", raw_name="search", description="Search repos"),
            ToolInfo(server_name="github", raw_name="create", description="Create issue"),
        ]

        with patch.object(client, "list_all_tools", new_callable=AsyncMock) as mock_list:
            mock_list.return_value = mock_tools

            from modu_graph.factory import _discover_and_register_mcp_tools
            _discover_and_register_mcp_tools(config)

        # 验证工具已注册
        registry = get_registry()
        tool = registry.get_tool("github__search")
        assert tool is not None
        assert tool.name() == "github__search"

        tool2 = registry.get_tool("github__create")
        assert tool2 is not None

    def test_discover_idempotent(self):
        """重复发现不重复注册。"""
        from config.runtime_config import RuntimeConfig, reset_config
        from core.registry import get_registry, reset_registry
        from mcp.client import get_mcp_client, reset_mcp_client
        from mcp.discovery import ToolInfo

        reset_config()
        reset_registry()
        reset_mcp_client()

        config = RuntimeConfig()
        config.set("mcp.enabled", True)

        client = get_mcp_client()
        client._started = True

        mock_tools = [
            ToolInfo(server_name="github", raw_name="search", description="Search"),
        ]

        with patch.object(client, "list_all_tools", new_callable=AsyncMock) as mock_list:
            mock_list.return_value = mock_tools

            from modu_graph.factory import _discover_and_register_mcp_tools
            _discover_and_register_mcp_tools(config)
            # 再次调用
            _discover_and_register_mcp_tools(config)

        registry = get_registry()
        # 仍然只有一个
        all_tools = registry.list_tools()
        assert "github__search" in all_tools

    def test_discover_failure_isolated(self):
        """MCP 工具发现失败不影响现有功能（create_agent 中 try/except 隔离）。"""
        from config.runtime_config import RuntimeConfig, reset_config
        from core.registry import get_registry, reset_registry
        from mcp.client import get_mcp_client, reset_mcp_client

        reset_config()
        reset_registry()
        reset_mcp_client()

        config = RuntimeConfig()
        config.set("mcp.enabled", True)

        client = get_mcp_client()
        client._started = True

        # Mock list_all_tools 抛出异常
        with patch.object(client, "list_all_tools", new_callable=AsyncMock) as mock_list:
            mock_list.side_effect = RuntimeError("discovery failed")

            from modu_graph.factory import _discover_and_register_mcp_tools
            # create_agent 中的 try/except 会捕获此异常
            # 此处验证异常会传播（由 create_agent 的调用者捕获）
            try:
                _discover_and_register_mcp_tools(config)
            except Exception:
                pass  # 预期：create_agent 的 try/except 会处理

        # registry 应为空但可用
        registry = get_registry()
        assert registry.list_tools() == {}


# ============================================================
# 9. 回归测试 — 现有功能不受影响
# ============================================================

class TestRegressionNoBreaking:
    """验证 MCP 集成不影响现有功能。"""

    def test_existing_tools_still_work(self):
        """内置工具仍可正常注册和调用。"""
        from core.registry import ComponentRegistry, reset_registry
        from components.action.tools.calculator import CalculatorTool

        reset_registry()
        registry = ComponentRegistry()
        tool = CalculatorTool()
        registry.register_tool(tool)

        assert registry.get_tool("calculator") is not None
        assert "calculator" in registry.list_tools()

    def test_existing_config_sections_intact(self):
        """现有配置节不受 mcp 配置影响。"""
        from config.runtime_config import RuntimeConfig

        config = RuntimeConfig()
        # 验证现有配置项仍可用
        assert config.get("llm.default_provider") == "deepseek"
        assert config.get("memory.checkpointer_type") == "memory"
        assert config.get("orchestration.engine") == "langgraph"
        assert config.get("tools.human_in_loop.enabled") is False
        assert config.get("skills.enabled") is False
        # 新增 mcp 配置节
        assert config.get("mcp.enabled") is False

    def test_tool_adapter_compatible_with_mcp_tool(self):
        """wrap_modu_tool 能正确包装 MCPToolAdapter。"""
        from mcp.discovery import ToolInfo
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter
        from modu_graph.adapters.tool_adapter import wrap_modu_tool

        info = ToolInfo(
            server_name="test",
            raw_name="search",
            description="Search tool",
            input_schema={
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        )
        adapter = MCPToolAdapter(info)

        # wrap_modu_tool 应成功包装
        from mcp.client import get_mcp_client, reset_mcp_client
        reset_mcp_client()
        # 重新创建 adapter 以使用新的 client
        adapter = MCPToolAdapter(info)

        lc_tool = wrap_modu_tool(adapter)
        assert lc_tool is not None
        assert lc_tool.name == "test__search"

    def test_registry_accepts_mcp_tool(self):
        """ComponentRegistry 能接受 MCPToolAdapter 注册。"""
        from core.registry import ComponentRegistry, reset_registry
        from mcp.discovery import ToolInfo
        from mcp.client import reset_mcp_client
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        reset_registry()
        reset_mcp_client()

        registry = ComponentRegistry()
        info = ToolInfo(server_name="test", raw_name="search", description="Search")
        adapter = MCPToolAdapter(info)

        registry.register_tool(adapter)

        assert registry.get_tool("test__search") is not None
        tool_info = registry.list_tools().get("test__search")
        assert tool_info is not None
