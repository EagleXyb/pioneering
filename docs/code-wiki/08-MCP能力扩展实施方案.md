# ModuAgent MCP 能力扩展实施方案

> 基于 `apps/backend/ModuAgent` 全量源码深度分析，参照 Anthropic MCP（Model Context Protocol）官方规范与 LangChain/LangGraph 生态集成最佳实践，为 ModuAgent 设计低侵入、高扩展的 MCP 集成方案。

---

## 一、现有架构痛点与扩展性分析

### 1.1 当前工具体系架构回顾

ModuAgent 的工具调用链路为**纯进程内同步调用**：

```
agent_bridge._init_moduagent()  (硬编码注册)
    → ComponentRegistry.register_tool()  (启动时注册)
    → factory.create_agent()
        → build_langchain_tools()  (从 registry 取工具)
        → llm.bind_tools(tools)  (绑定到 LLM)
    → graph.astream()
        → agent_node (LLM 决策 tool_calls)
        → ToolNode (调用 StructuredTool._invoke)
            → modu_tool.invoke(params, context)  (直接 Python 方法调用)
        → tool_result_processor (提取结果)
```

关键源码锚点：

| 文件 | 关键函数/类 | 作用 |
|------|------------|------|
| [agent_bridge.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/agent_bridge.py#L45-L83) | `_init_moduagent()` | 启动时硬编码注册所有内置工具到 ComponentRegistry |
| [registry.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/registry.py#L89-L107) | `register_tool` / `get_tool` / `list_tools` | 以 `tool.name()` 为 key 的工具注册表 |
| [tool_adapter.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/adapters/tool_adapter.py#L79-L123) | `wrap_modu_tool()` | 将 BaseTool 包装为 LangChain StructuredTool |
| [tool_adapter.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/adapters/tool_adapter.py#L126-L169) | `build_langchain_tools()` | 从 registry 批量构建 LangChain 工具列表 |
| [factory.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/factory.py#L227-L228) | `create_agent()` 中工具构建段 | 调用 `build_langchain_tools(tool_names=tool_names)` |
| [action.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/interfaces/action.py#L22-L68) | `BaseTool` ABC | 工具抽象接口（name/description/schema/invoke + HITL） |

### 1.2 五大痛点

#### 痛点 1：工具注册完全硬编码，无运行时动态发现

`_init_moduagent()` 在 [agent_bridge.py:45-83](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/agent_bridge.py#L45-L83) 中逐行硬编码注册 7 个内置工具：

```python
registry.register_tool(CalculatorTool())
registry.register_tool(SearchTool())
registry.register_tool(CodeExecutorTool())
# ... 手动逐个注册
```

新增工具必须修改此函数并重新部署。Skill 系统（`skills/loader.py`）虽然实现了目录扫描动态加载，但仅限于 `skills.auto_discover_dirs` 下的本地文件，无法接入外部独立进程提供的工具。

#### 痛点 2：工具调用为进程内同步，无法跨进程/跨语言

`BaseTool.invoke(params, context)` 是同步 Python 方法调用，工具实例与 Agent 运行在同一进程内。无法连接外部工具服务（如数据库工具服务、文件系统工具服务、第三方 API 工具服务）。

#### 痛点 3：工具来源单一，无法组合多源工具

当前工具来源仅有两个：
1. `agent_bridge._init_moduagent()` 硬编码注册的 7 个内置工具
2. Skill 系统通过目录扫描加载的 Skill 工具（默认关闭）

无法将远程 MCP Server 提供的工具与本地工具组合使用，限制了 Agent 的能力边界。

#### 痛点 4：缺少标准化的工具描述协议

内置工具通过 `BaseTool.parameters_schema()` 返回 JSON Schema，但这是 Python 字典层面的约定，没有标准化的序列化/传输/发现协议。MCP 提供了标准化的 `tools/list` → `tools/call` JSON-RPC 协议，ModuAgent 无法利用。

#### 痛点 5：无法利用 MCP 生态的现有 Server

MCP 生态已有大量开源 Server（GitHub、文件系统、数据库、Slack、Google Drive 等），ModuAgent 无法直接接入这些 Server，每个外部集成都需要从零开发为内置工具。

### 1.3 扩展性优势（可利用的已有设计）

尽管存在痛点，ModuAgent 的架构设计中有多处**为 MCP 集成提供了天然扩展点**：

| 已有设计 | 如何支撑 MCP 集成 |
|---------|------------------|
| **BaseTool ABC** 接口 | MCP Tool 只需实现 `name()/description()/parameters_schema()/invoke()` 四个方法即可适配，接口完全兼容 |
| **ComponentRegistry** 注册表 | MCP 工具可动态注册到 `_tools` 字典，`build_langchain_tools()` 自动从 registry 取出，对上层透明 |
| **tool_adapter.py** 适配器层 | `wrap_modu_tool()` 已将 BaseTool → StructuredTool，MCP 工具适配后同样走此路径 |
| **factory.create_agent()** 的 `tool_names` 参数 | 已支持运行时筛选工具子集，MCP 工具名可混入此列表 |
| **HITL 机制** | `requires_approval()` + `interrupt()` 对 MCP 工具同样生效，敏感远程工具可声明需审批 |
| **RuntimeConfig** 配置驱动 | 新增 `mcp.*` 配置节即可，`get("mcp.servers")` 读取配置 |
| **Skill 动态加载模式** | `SkillLoader` 的目录扫描 + importlib 模式可参考用于 MCP Server 配置驱动加载 |
| **事件总线** | MCP 工具调用可发布 TOOL.INVOKE/EXECUTE 事件，复用现有可观测性 |
| **重试机制** | `with_tool_retry()` 可包装 MCP 工具调用，对网络异常自动重试 |

---

## 二、MCP Client 核心模块设计

### 2.1 整体模块拓扑

```
apps/backend/ModuAgent/
├── mcp/                                    # 新增：MCP 集成根目录
│   ├── __init__.py                         # 导出公共 API
│   ├── client.py                           # MCPClient — 连接管理 + 会话管理
│   ├── transport.py                        # 传输层抽象（stdio / SSE / streamable_http）
│   ├── discovery.py                        # 工具发现 + 缓存
│   ├── lifecycle.py                        # Server 生命周期管理（启动/停止/健康检查）
│   └── errors.py                           # MCP 错误码定义
├── modu_graph/adapters/
│   └── mcp_tool_adapter.py                 # 新增：MCP Tool → BaseTool 适配器
├── config/
│   └── runtime_config.py                  # 新增 mcp.* 配置节（修改 _DEFAULT_CONFIG）
└── core/
    └── registry.py                         # 无需修改（MCP 工具通过 register_tool 注册）
```

### 2.2 MCPClient — 连接管理与会话管理

**职责**：管理到多个 MCP Server 的连接，维护会话状态，提供统一的工具调用入口。

**设计要点**：
- 一个 MCPClient 实例管理多个 Server 连接
- 每个连接对应一个 `MCPSession`（封装 MCP 协议会话）
- 连接池支持复用、超时、自动重连
- 异步优先（与 LangGraph 的 `astream` 一致）

```python
# mcp/client.py

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from mcp.transport import Transport, StdioTransport, SSETransport
from mcp.discovery import ToolDiscovery, ToolInfo
from mcp.errors import MCPConnectionError, MCPTimeoutError
from mcp.lifecycle import ServerLifecycleManager

logger = logging.getLogger(__name__)


class MCPSession:
    """单个 MCP Server 的会话封装。

    每个会话对应一个 transport 连接，维护：
    - server_name: Server 标识（来自配置）
    - transport: 传输层实例
    - _tools_cache: 工具列表缓存（discovery 后填充）
    - _connected: 连接状态
    """

    def __init__(self, server_name: str, transport: Transport) -> None:
        self.server_name = server_name
        self._transport = transport
        self._tools_cache: List[ToolInfo] = []
        self._connected: bool = False
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        """建立连接并完成 MCP 握手（initialize → initialized）。"""
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
            await self._transport.disconnect()
            self._connected = False
            self._tools_cache.clear()
            logger.info("MCP session disconnected: server=%s", self.server_name)

    async def list_tools(self, use_cache: bool = True) -> List[ToolInfo]:
        """发现 Server 暴露的工具列表。

        Args:
            use_cache: True 时返回缓存（首次或过期后重新发现）

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
            工具执行结果（MCP 标准返回格式）
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
        except asyncio.TimeoutError:
            raise MCPTimeoutError(
                f"MCP tool '{tool_name}' on server '{self.server_name}' "
                f"timed out after {timeout}s"
            )

    @property
    def connected(self) -> bool:
        return self._connected


class MCPClient:
    """MCP Client 多连接管理器。

    管理到多个 MCP Server 的连接，提供统一的工具发现和调用入口。
    设计为单例（与 ComponentRegistry / RuntimeConfig 风格一致）。

    用法：
        client = get_mcp_client()
        await client.start(config)       # 启动时连接所有配置的 Server
        tools = await client.list_all_tools()  # 发现所有 Server 的工具
        result = await client.call_tool("github_search", {"query": "..."})
        await client.stop()              # 关闭时断开所有连接
    """

    def __init__(self) -> None:
        self._sessions: Dict[str, MCPSession] = {}
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

                # 若配置了 auto_start，由 lifecycle 启动子进程
                if server_cfg.get("auto_start", False):
                    await self._lifecycle.start_server(server_cfg)

                await session.connect()
                self._sessions[server_cfg["name"]] = session
            except Exception as e:  # noqa: BLE001
                logger.error(
                    "Failed to connect MCP server '%s': %s",
                    server_cfg.get("name", "unknown"), e,
                )
                # 单个 Server 失败不阻断其他 Server 连接

        self._started = True
        logger.info("MCPClient started: %d/%d servers connected",
                    len(self._sessions), len(servers_config))

    async def stop(self) -> None:
        """断开所有连接并停止子进程。"""
        for name, session in list(self._sessions.items()):
            try:
                await session.disconnect()
            except Exception as e:  # noqa: BLE001
                logger.warning("Error disconnecting MCP server '%s': %s", name, e)
        self._sessions.clear()

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

        工具名格式："<server_name>__<tool_name>"（双下划线分隔）。
        若无分隔符，在所有 Server 中查找。

        Args:
            tool_name: 工具全名（含 server 前缀）或裸名
            arguments: 工具参数
            timeout: 调用超时秒

        Returns:
            MCP 标准返回格式

        Raises:
            KeyError: 工具未找到
            MCPTimeoutError: 调用超时
        """
        server_name, raw_tool_name = self._resolve_tool(tool_name)
        session = self._sessions.get(server_name)
        if session is None or not session.connected:
            raise MCPConnectionError(
                f"MCP server '{server_name}' not connected for tool '{tool_name}'"
            )
        return await session.call_tool(raw_tool_name, arguments, timeout=timeout)

    def _resolve_tool(self, tool_name: str) -> tuple[str, str]:
        """解析工具名为 (server_name, raw_tool_name)。

        支持两种格式：
        1. "server_name__tool_name" → 直接解析
        2. "tool_name" → 在所有 Server 中搜索（首个命中）
        """
        if "__" in tool_name:
            parts = tool_name.split("__", 1)
            return parts[0], parts[1]

        # 无前缀：在所有 session 的缓存中搜索
        for name, session in self._sessions.items():
            for tool in session._tools_cache:
                if tool.raw_name == tool_name:
                    return name, tool_name
        raise KeyError(f"Tool '{tool_name}' not found in any connected MCP server")

    @staticmethod
    def _create_transport(server_cfg: Dict[str, Any]) -> Transport:
        """根据配置创建传输层实例。"""
        transport_type = server_cfg.get("transport", "stdio")

        if transport_type == "stdio":
            return StdioTransport(
                command=server_cfg["command"],
                args=server_cfg.get("args", []),
                env=server_cfg.get("env", {}),
                cwd=server_cfg.get("cwd"),
            )
        elif transport_type == "sse":
            return SSETransport(url=server_cfg["url"])
        elif transport_type == "streamable_http":
            return SSETransport(url=server_cfg["url"])  # 复用 SSE 实现
        else:
            raise ValueError(f"Unknown MCP transport type: {transport_type}")

    @property
    def sessions(self) -> Dict[str, MCPSession]:
        return dict(self._sessions)

    @property
    def started(self) -> bool:
        return self._started


# ============================================================
# 全局单例（与 ComponentRegistry / RuntimeConfig 风格一致）
# ============================================================

_mcp_client: Optional[MCPClient] = None


def get_mcp_client() -> MCPClient:
    """获取全局 MCPClient 单例。"""
    global _mcp_client
    if _mcp_client is None:
        _mcp_client = MCPClient()
    return _mcp_client


def reset_mcp_client() -> None:
    """重置单例（测试清理用）。"""
    global _mcp_client
    _mcp_client = None
```

### 2.3 传输层抽象

**职责**：封装 stdio / SSE / streamable_http 三种 MCP 传输协议。

```python
# mcp/transport.py

from __future__ import annotations

import asyncio
import os
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class Transport(ABC):
    """MCP 传输层抽象基类。

    所有传输方式实现统一的 request/notify 接口，
    使上层 MCPSession 无需感知底层传输细节。
    """

    @abstractmethod
    async def connect(self) -> None:
        """建立传输连接。"""
        ...

    @abstractmethod
    async def disconnect(self) -> None:
        """断开传输连接。"""
        ...

    @abstractmethod
    async def request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """发送 JSON-RPC 请求并等待响应。

        Args:
            method: MCP 方法名（如 "tools/list"、"tools/call"）
            params: 方法参数

        Returns:
            JSON-RPC 响应的 result 字段
        """
        ...

    @abstractmethod
    async def notify(self, method: str, params: Dict[str, Any]) -> None:
        """发送 JSON-RPC 通知（无响应）。"""
        ...


class StdioTransport(Transport):
    """stdio 传输：通过子进程 stdin/stdout 通信。

    最常用的 MCP 传输方式，Server 作为子进程运行。
    """

    def __init__(
        self,
        command: str,
        args: List[str],
        env: Optional[Dict[str, str]] = None,
        cwd: Optional[str] = None,
    ) -> None:
        self._command = command
        self._args = args
        # 合并环境变量：当前进程环境 + 额外配置
        self._env = {**os.environ, **(env or {})}
        self._cwd = cwd
        self._process: Optional[asyncio.subprocess.Process] = None
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._request_id = 0
        self._pending: Dict[int, asyncio.Future] = {}

    async def connect(self) -> None:
        """启动子进程并建立 stdin/stdout 管道。"""
        self._process = await asyncio.create_subprocess_exec(
            self._command,
            *self._args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=self._env,
            cwd=self._cwd,
        )
        self._reader = self._process.stdout
        self._writer = self._process.stdin
        # 启动后台读取循环
        asyncio.create_task(self._read_loop())

    async def disconnect(self) -> None:
        """终止子进程。"""
        if self._process and self._process.returncode is None:
            self._process.terminate()
            await self._process.wait()
        self._process = None
        self._reader = None
        self._writer = None

    async def request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        self._request_id += 1
        req_id = self._request_id
        msg = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params,
        }
        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[req_id] = future

        data = (json.dumps(msg) + "\n").encode()
        self._writer.write(data)
        await self._writer.drain()

        return await future

    async def notify(self, method: str, params: Dict[str, Any]) -> None:
        msg = {"jsonrpc": "2.0", "method": method, "params": params}
        data = (json.dumps(msg) + "\n").encode()
        self._writer.write(data)
        await self._writer.drain()

    async def _read_loop(self) -> None:
        """后台读取子进程 stdout，按行解析 JSON-RPC 消息。"""
        while self._reader:
            line = await self._reader.readline()
            if not line:
                break
            try:
                msg = json.loads(line.decode())
                req_id = msg.get("id")
                if req_id is not None and req_id in self._pending:
                    future = self._pending.pop(req_id)
                    if "error" in msg:
                        future.set_exception(
                            Exception(f"MCP error: {msg['error']}")
                        )
                    else:
                        future.set_result(msg.get("result", {}))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue  # 跳过非 JSON 行


class SSETransport(Transport):
    """SSE / streamable_http 传输：通过 HTTP SSE 连接远程 Server。"""

    def __init__(self, url: str) -> None:
        self._url = url
        self._session: Optional[Any] = None  # httpx.AsyncClient
        self._request_id = 0

    async def connect(self) -> None:
        import httpx
        self._session = httpx.AsyncClient(base_url=self._url, timeout=30.0)

    async def disconnect(self) -> None:
        if self._session:
            await self._session.aclose()
            self._session = None

    async def request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        self._request_id += 1
        resp = await self._session.post("/", json={
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        })
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise Exception(f"MCP error: {data['error']}")
        return data.get("result", {})

    async def notify(self, method: str, params: Dict[str, Any]) -> None:
        await self._session.post("/", json={
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        })
```

### 2.4 工具发现与缓存

**职责**：从 MCP Server 发现工具，缓存工具元信息，提供查询接口。

```python
# mcp/discovery.py

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ToolInfo:
    """MCP 工具元信息（从 tools/list 响应解析）。

    字段对应 MCP 规范的 Tool 定义。
    """
    server_name: str           # 来源 Server 名
    raw_name: str             # Server 内工具名
    description: str          # 工具描述
    input_schema: Dict[str, Any] = field(default_factory=dict)  # JSON Schema

    @property
    def qualified_name(self) -> str:
        """全限定名：server_name__raw_name（避免跨 Server 工具名冲突）。"""
        return f"{self.server_name}__{self.raw_name}"

    @classmethod
    def from_mcp_dict(cls, server_name: str, raw: Dict[str, Any]) -> "ToolInfo":
        """从 MCP tools/list 响应项构建 ToolInfo。"""
        return cls(
            server_name=server_name,
            raw_name=raw.get("name", ""),
            description=raw.get("description", ""),
            input_schema=raw.get("inputSchema", {}),
        )

    def to_base_tool_schema(self) -> Dict[str, Any]:
        """转换为 ModuAgent BaseTool.parameters_schema() 格式。

        MCP 的 inputSchema 已经是标准 JSON Schema，
        直接返回即可（与 parameters_schema() 约定一致）。
        """
        return self.input_schema


class ToolDiscovery:
    """工具发现服务。

    提供工具发现、缓存、查询能力。
    由 MCPClient 调用，不直接持有 transport。
    """

    def __init__(self) -> None:
        self._cache: Dict[str, List[ToolInfo]] = {}  # server_name → tools

    def update(self, server_name: str, tools: List[ToolInfo]) -> None:
        """更新指定 Server 的工具缓存。"""
        self._cache[server_name] = tools
        logger.info("Tool cache updated: server=%s, count=%d", server_name, len(tools))

    def get_all(self) -> List[ToolInfo]:
        """返回所有缓存工具。"""
        all_tools: List[ToolInfo] = []
        for tools in self._cache.values():
            all_tools.extend(tools)
        return all_tools

    def get_by_server(self, server_name: str) -> List[ToolInfo]:
        """返回指定 Server 的工具。"""
        return self._cache.get(server_name, [])

    def find_by_name(self, tool_name: str) -> Optional[ToolInfo]:
        """按全限定名或裸名查找工具。

        优先匹配全限定名，其次裸名（首个命中）。
        """
        # 全限定名匹配
        for tools in self._cache.values():
            for tool in tools:
                if tool.qualified_name == tool_name:
                    return tool
        # 裸名匹配
        for tools in self._cache.values():
            for tool in tools:
                if tool.raw_name == tool_name:
                    return tool
        return None

    def clear(self) -> None:
        """清空缓存。"""
        self._cache.clear()
```

### 2.5 Server 生命周期管理

**职责**：管理 stdio 类型 MCP Server 子进程的启动、停止、健康检查。

```python
# mcp/lifecycle.py

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class ServerLifecycleManager:
    """MCP Server 子进程生命周期管理。

    仅对 transport=stdio 且 auto_start=True 的 Server 生效。
    SSE/HTTP 类型的 Server 由远程管理，此处不涉及。
    """

    def __init__(self) -> None:
        self._processes: Dict[str, asyncio.subprocess.Process] = {}

    async def start_server(self, server_cfg: Dict[str, Any]) -> None:
        """启动 MCP Server 子进程。

        仅在 transport=stdio 且 auto_start=True 时调用。
        StdioTransport.connect() 内部会启动子进程，
        此方法作为可选的预启动/监控入口。
        """
        name = server_cfg.get("name", "unknown")
        if name in self._processes:
            logger.debug("Server '%s' already started", name)
            return
        # 子进程由 StdioTransport.connect() 管理
        # 此处仅记录状态，供 stop_all 使用
        logger.info("Server '%s' lifecycle tracked", name)

    async def stop_server(self, name: str) -> None:
        """停止指定 Server。"""
        proc = self._processes.pop(name, None)
        if proc and proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
            logger.info("Server '%s' stopped", name)

    async def stop_all(self) -> None:
        """停止所有 Server。"""
        names = list(self._processes.keys())
        for name in names:
            await self.stop_server(name)

    async def health_check(self, name: str) -> bool:
        """检查 Server 健康状态（进程是否存活）。"""
        proc = self._processes.get(name)
        if proc is None:
            return False
        return proc.returncode is None
```

### 2.6 错误码定义

```python
# mcp/errors.py

"""MCP 集成错误码。

与 ModuAgent 现有错误码体系（ErrorCode 常量类）风格一致，
使用 <DOMAIN>_<NUMBER> 格式。
"""


class MCPError(Exception):
    """MCP 集成基础异常。"""
    error_code = "MCP_000"


class MCPConnectionError(MCPError):
    """连接 MCP Server 失败。"""
    error_code = "MCP_001"


class MCPTimeoutError(MCPError):
    """MCP 工具调用超时。"""
    error_code = "MCP_002"


class MCPToolNotFoundError(MCPError):
    """MCP 工具未找到。"""
    error_code = "MCP_003"


class MCPProtocolError(MCPError):
    """MCP 协议错误（JSON-RPC 错误响应）。"""
    error_code = "MCP_004"
```

---

## 三、Agent 调度执行流程集成点与适配器设计

### 3.1 集成策略：零侵入适配

**核心原则**：MCP 工具对 LangGraph 图、agent_node、ToolNode、tool_result_processor **完全透明**。

实现路径：
1. MCP 工具通过 `MCPToolAdapter` 包装为 `BaseTool` 子类
2. 注册到 `ComponentRegistry._tools`（与内置工具同一注册表）
3. `build_langchain_tools()` 自动从 registry 取出并包装为 `StructuredTool`
4. 图的 `ToolNode` 调用 `StructuredTool._invoke()` → `MCPToolAdapter.invoke()` → `MCPClient.call_tool()`

```
┌──────────────────────────────────────────────────────────────────────┐
│                        ModuAgent 进程                                 │
│                                                                      │
│  ┌──────────┐    ┌──────────┐    ┌─────────────────┐               │
│  │ LLM      │───▶│ ToolNode │───▶│ StructuredTool   │               │
│  │(决策调用) │    │(LangGraph)│   │ (tool_adapter)  │               │
│  └──────────┘    └──────────┘    └────────┬────────┘               │
│                                           │                          │
│                                           │ BaseTool.invoke()        │
│                                           ▼                          │
│                                 ┌─────────────────┐                 │
│                                 │ MCPToolAdapter   │  ← 新增        │
│                                 │ (BaseTool 子类)  │                 │
│                                 └────────┬────────┘                 │
│                                          │                           │
│              ┌───────────────────────────┼───────────────────┐      │
│              │                           │                   │      │
│  ┌──────────┐│  ┌──────────┐    ┌────────▼───────┐   ┌──────▼────┐ │
│  │Calculator││  │SearchTool│    │ MCPClient       │   │ 内置工具  │ │
│  │Tool      ││  │          │    │ (本地→远程路由)  │   │ (进程内)  │ │
│  └──────────┘│  └──────────┘    └────────┬───────┘   └───────────┘ │
│              │                           │                          │
│              │              ┌────────────┼────────────┐            │
│              │              │            │            │            │
│              │     ┌────────▼──┐  ┌──────▼─────┐  ┌──▼────────┐  │
│              │     │MCPSession A│  │MCPSession B│  │Session C  │  │
│              │     │(stdio)     │  │(SSE)       │  │(stdio)    │  │
│              │     └────────┬───┘  └──────┬─────┘  └──┬────────┘  │
│              │              │             │           │            │
│              │     ┌────────▼───┐  ┌──────▼─────┐  ┌──▼────────┐  │
│              │     │GitHub MCP  │  │Slack MCP   │  │Filesystem │  │
│              │     │Server(子进程)│  │Server(远程) │  │MCP Server │  │
│              │     └────────────┘  └────────────┘  └───────────┘  │
│              │                                                    │
└──────────────┼────────────────────────────────────────────────────┘
               │
         JSON-RPC (stdio pipe / SSE HTTP)
```

### 3.2 MCPToolAdapter — 工具适配器

**职责**：将 MCP 远程工具适配为 ModuAgent `BaseTool` 接口，使 LangGraph 的 ToolNode 可无感调用。

```python
# modu_graph/adapters/mcp_tool_adapter.py

"""MCP Tool → ModuAgent BaseTool 适配器。

设计原则：
    - 零侵入：MCP 工具适配为 BaseTool 子类后，与内置工具
      （calculator/search/code_executor 等）在 registry 和图中无差异。
    - 异步转同步：LangGraph ToolNode 调用 StructuredTool 的同步 _invoke，
      适配器内部通过 asyncio.run() 将 MCP 异步调用桥接为同步。
    - 复用现有基础设施：HITL 审批、重试、事件发布等机制对 MCP 工具同样生效。
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, Optional

from core.interfaces.action import BaseTool
from mcp.client import get_mcp_client
from mcp.discovery import ToolInfo
from mcp.errors import MCPError, MCPTimeoutError

logger = logging.getLogger(__name__)


class MCPToolAdapter(BaseTool):
    """将 MCP 远程工具适配为 ModuAgent BaseTool。

    每个 ToolInfo 实例对应一个 MCPToolAdapter。
    注册到 ComponentRegistry 后，build_langchain_tools() 自动取出，
    经 wrap_modu_tool() 包装为 StructuredTool，绑定到 LLM。

    调用链路：
        ToolNode → StructuredTool._invoke → MCPToolAdapter.invoke
        → MCPClient.call_tool → MCPSession.call_tool → Transport.request
        → JSON-RPC → MCP Server → 返回结果
    """

    def __init__(self, tool_info: ToolInfo) -> None:
        self._tool_info = tool_info
        self._mcp_client = get_mcp_client()

    def name(self) -> str:
        """工具全限定名（server_name__raw_name）。

        使用全限定名避免不同 Server 的同名工具冲突。
        """
        return self._tool_info.qualified_name

    def description(self) -> str:
        """工具描述（来自 MCP Server 的 tools/list 响应）。"""
        desc = self._tool_info.description
        server = self._tool_info.server_name
        return f"[MCP:{server}] {desc}"

    def parameters_schema(self) -> Dict[str, Any]:
        """JSON Schema 参数定义（来自 MCP Server 的 inputSchema）。"""
        return self._tool_info.to_base_tool_schema()

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """调用 MCP 远程工具。

        将异步 MCP 调用桥接为同步（ToolNode 要求同步返回）。
        使用 asyncio.run() 在当前线程创建事件循环。

        返回结构与内置工具一致：{"status": "success/error", "data": {...}}
        """
        try:
            result = asyncio.run(self._invoke_async(params))
            return self._format_result(result)
        except MCPTimeoutError as e:
            logger.error("MCP tool '%s' timeout: %s", self.name(), e)
            return {
                "status": "error",
                "error_code": e.error_code,
                "data": {"message": str(e), "tool": self.name()},
            }
        except MCPError as e:
            logger.error("MCP tool '%s' error: %s", self.name(), e)
            return {
                "status": "error",
                "error_code": e.error_code,
                "data": {"message": str(e), "tool": self.name()},
            }
        except Exception as e:  # noqa: BLE001
            logger.error("MCP tool '%s' unexpected error: %s", self.name(), e)
            return {
                "status": "error",
                "error_code": "MCP_000",
                "data": {"message": str(e), "tool": self.name()},
            }

    async def _invoke_async(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """异步调用 MCP 工具。"""
        return await self._mcp_client.call_tool(
            tool_name=self._tool_info.qualified_name,
            arguments=params,
            timeout=30.0,
        )

    def _format_result(self, mcp_result: Dict[str, Any]) -> Dict[str, Any]:
        """将 MCP 返回格式转换为 ModuAgent 标准结构。

        MCP 返回格式：
            {"content": [{"type": "text", "text": "..."}], "isError": false}

        ModuAgent 标准结构：
            {"status": "success", "data": {"result": ...}}
        """
        is_error = mcp_result.get("isError", False)
        content = mcp_result.get("content", [])

        # 提取文本内容
        text_parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text_parts.append(item.get("text", ""))

        result_text = "\n".join(text_parts) if text_parts else json.dumps(mcp_result)

        if is_error:
            return {
                "status": "error",
                "error_code": "MCP_004",
                "data": {"message": result_text, "tool": self.name()},
            }

        return {
            "status": "success",
            "data": {"result": result_text, "source": "mcp", "server": self._tool_info.server_name},
        }

    def requires_approval(self) -> bool:
        """MCP 工具默认不需要审批。

        可通过配置 tools.human_in_loop.sensitive_tools 指定
        特定 MCP 工具名需审批（由 human_review_node 的 _tool_requires_approval 检查）。
        """
        return False
```

### 3.3 集成点 1：factory.py 的 `create_agent()`

**修改文件**：[factory.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/factory.py)

**修改位置**：`create_agent()` 函数中 `build_langchain_tools()` 调用前（约 L218）

**修改内容**：在构建 LangChain 工具列表前，先从 MCPClient 发现远程工具并注册到 registry。

```python
# factory.py create_agent() 中的修改（伪代码示意）

# --- 现有代码（L213-L228）---
# LLM 构造
llm = build_chat_model(provider=provider, config=runtime_config, ...)

# === 新增：MCP 工具发现与注册 ===
# 在 build_langchain_tools 之前，从 MCP Client 发现工具并注册到 registry
if runtime_config.get("mcp.enabled", False):
    try:
        from mcp.client import get_mcp_client
        from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

        mcp_client = get_mcp_client()
        if not mcp_client.started:
            import asyncio
            asyncio.run(mcp_client.start(runtime_config))

        # 发现所有 MCP 工具
        mcp_tools = asyncio.run(mcp_client.list_all_tools())
        for tool_info in mcp_tools:
            adapter = MCPToolAdapter(tool_info)
            # 注册到 ComponentRegistry（与内置工具同一注册表）
            # 若已存在则跳过（幂等）
            if registry.get_tool(adapter.name()) is None:
                registry.register_tool(adapter)

        logger.info("MCP tools registered: %d", len(mcp_tools))
    except Exception as e:
        logger.warning("MCP tool discovery failed, continuing without MCP tools: %s", e)
# === MCP 集成结束 ===

# 工具构造（现有代码，无需修改）
tool_names = configurable.get("tools")
tools = build_langchain_tools(tool_names=tool_names, config=runtime_config)

# LLM 绑定工具（现有代码，无需修改）
bound_llm = llm.bind_tools(tools) if tools else llm
```

**关键设计**：
- MCP 工具注册被 try/except 隔离，失败不影响 Agent 启动
- 注册是幂等的——已注册的工具跳过
- MCP 工具与内置工具混入同一个 `tools` 列表，LLM 统一 function calling
- `tool_names` 参数支持筛选 MCP 工具（全限定名格式 `server_name__tool_name`）

### 3.4 集成点 2：agent_bridge.py 的 `_init_moduagent()`

**修改文件**：[agent_bridge.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/agent_bridge.py)

**修改位置**：`_init_moduagent()` 函数末尾（约 L83）

**修改内容**：在注册完内置工具后，触发 MCP 工具发现。

```python
# agent_bridge.py _init_moduagent() 末尾新增

def _init_moduagent() -> None:
    global _registered
    if _registered:
        return
    # ... 现有内置工具注册代码 ...

    _registered = True

    # === 新增：MCP 工具发现（异步，不阻塞启动）===
    # MCP 工具的实际发现在 factory.create_agent() 中触发
    # 此处仅设置环境变量/路径，确保 mcp 模块可导入
    _ensure_mcp_module_importable()


def _ensure_mcp_module_importable() -> None:
    """确保 mcp 模块可被导入（已在 sys.path 中的 ModuAgent 目录下）。"""
    try:
        import mcp  # noqa: F401
    except ImportError:
        pass  # mcp 模块不存在时，factory 中会 catch 并跳过
```

### 3.5 集成点 3：agent_bridge.py 的 `stream_agent_completion()`

**修改文件**：[agent_bridge.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/agent_bridge.py)

**修改位置**：`stream_agent_completion()` 函数（约 L88）

**修改内容**：在创建 Agent 后、流式响应完成后，确保 MCP 连接被清理。

```python
# agent_bridge.py stream_agent_completion() 中的修改

async def stream_agent_completion(message, session_id, user_id, ctx, model, system_prompt, history):
    _init_moduagent()
    from modu_graph.factory import create_agent
    # ...

    graph = create_agent()  # 内部会触发 MCP 工具发现

    try:
        # ... 现有流式响应代码 ...
        async for event_dict in adapter.transform_langgraph_events(...):
            yield event_dict
            _collect_metadata_from_event(event_dict, ctx)
    finally:
        # === 新增：MCP 连接保持（不在此关闭，由进程生命周期管理）===
        # MCPClient 是全局单例，跨请求复用连接
        # 仅在进程退出时关闭（见 app/main.py lifespan）
        pass
```

### 3.6 集成点 4：app/main.py 的 lifespan

**修改文件**：[app/main.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py)

**修改位置**：`lifespan` 异步上下文管理器

**修改内容**：在应用启动时初始化 MCP Client，在关闭时清理连接。

```python
# app/main.py lifespan 中的修改

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动
    await init_db()

    # === 新增：MCP Client 初始化 ===
    try:
        from mcp.client import get_mcp_client
        from config.runtime_config import get_config
        mcp_client = get_mcp_client()
        if not mcp_client.started:
            await mcp_client.start(get_config())
    except Exception as e:
        logger.warning("MCP client init failed: %s", e)
    # === MCP 初始化结束 ===

    yield

    # 关闭
    # === 新增：MCP Client 清理 ===
    try:
        from mcp.client import get_mcp_client
        await get_mcp_client().stop()
    except Exception as e:
        logger.warning("MCP client stop failed: %s", e)
    # === MCP 清理结束 ===
```

### 3.7 数据流全景

完整的 MCP 工具调用数据流：

```
用户请求
  │
  ▼
agent_bridge.stream_agent_completion()
  │
  ├─ _init_moduagent()          # 注册内置工具（7个）
  │
  ├─ create_agent()             # factory.py
  │   ├─ build_chat_model()     # 构建 LLM
  │   ├─ [新增] MCP 工具发现      # 从 MCPClient.list_all_tools()
  │   │   └─ MCPToolAdapter     # 包装为 BaseTool
  │   │       └─ registry.register_tool()  # 注册到 ComponentRegistry
  │   ├─ build_langchain_tools() # 从 registry 构建工具列表（内置 + MCP）
  │   │   └─ wrap_modu_tool()   # BaseTool → StructuredTool
  │   └─ llm.bind_tools(tools)  # 绑定到 LLM（含 MCP 工具）
  │
  ├─ graph.astream()            # LangGraph 执行
  │   ├─ agent_node             # LLM 决策调用 MCP 工具
  │   │   └─ AIMessage.tool_calls = [{"name": "github__search_repos", ...}]
  │   │
  │   ├─ [HITL] human_review_node  # 若 MCP 工具在 sensitive_tools 列表
  │   │   └─ interrupt()        # 暂停等待审批
  │   │
  │   ├─ ToolNode               # LangGraph 调用 StructuredTool
  │   │   └─ StructuredTool._invoke()
  │   │       └─ MCPToolAdapter.invoke(params, context)
  │   │           └─ asyncio.run(MCPClient.call_tool("github__search_repos", params))
  │   │               └─ MCPSession.call_tool("search_repos", params)
  │   │                   └─ Transport.request("tools/call", {...})
  │   │                       └─ JSON-RPC → GitHub MCP Server (子进程)
  │   │                           └─ 返回 {"content": [...], "isError": false}
  │   │
  │   ├─ tool_result_processor  # 提取 ToolMessage → tool_results
  │   │
  │   ├─ agent_node (ReAct 循环) # LLM 根据工具结果继续推理
  │   │
  │   └─ response → feedback → memory_update → END
  │
  └─ AGUIStreamAdapter          # SSE 事件流
      └─ 前端展示
```

---

## 四、配置化接入 MCP Server 规范

### 4.1 RuntimeConfig 新增 `mcp` 配置节

**修改文件**：[runtime_config.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/config/runtime_config.py)

**修改位置**：`_DEFAULT_CONFIG` 字典中新增 `mcp` 键

```python
# runtime_config.py _DEFAULT_CONFIG 中新增

"mcp": {
    "enabled": False,               # 全局开关（默认关闭）
    "default_timeout": 30.0,        # MCP 工具调用默认超时（秒）
    "retry_on_disconnect": True,    # 连接断开时是否自动重连
    "servers": [                    # MCP Server 配置列表
        # 示例配置（实际使用时在 JSON 配置文件中定义）
        # {
        #     "name": "github",
        #     "enabled": True,
        #     "transport": "stdio",
        #     "command": "npx",
        #     "args": ["-y", "@modelcontextprotocol/server-github"],
        #     "env": {"GITHUB_TOKEN": "${GITHUB_TOKEN}"},
        #     "auto_start": True,
        # },
        # {
        #     "name": "filesystem",
        #     "enabled": True,
        #     "transport": "stdio",
        #     "command": "npx",
        #     "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/workspace"],
        #     "env": {},
        #     "auto_start": True,
        # },
        # {
        #     "name": "slack",
        #     "enabled": False,
        #     "transport": "sse",
        #     "url": "http://localhost:3001/sse",
        # },
    ],
},
```

### 4.2 Server 配置数据结构规范

每个 MCP Server 配置项的字段规范：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `name` | `str` | ✅ | - | Server 唯一标识（用于工具全限定名前缀） |
| `enabled` | `bool` | ❌ | `True` | 是否启用此 Server |
| `transport` | `str` | ✅ | - | 传输方式：`stdio` / `sse` / `streamable_http` |
| `command` | `str` | ⚠️ | - | stdio 专属：启动命令（如 `npx`、`python`、`node`） |
| `args` | `List[str]` | ❌ | `[]` | stdio 专属：命令参数 |
| `env` | `Dict[str, str]` | ❌ | `{}` | stdio 专属：环境变量（合并到当前进程环境） |
| `cwd` | `str` | ❌ | `None` | stdio 专属：工作目录 |
| `url` | `str` | ⚠️ | - | SSE/streamable_http 专属：Server URL |
| `auto_start` | `bool` | ❌ | `False` | 是否自动启动子进程（stdio 专属） |
| `timeout` | `float` | ❌ | `30.0` | 工具调用超时秒数（覆盖全局 `mcp.default_timeout`） |

**约束**：
- `transport=stdio` 时，`command` 必填
- `transport=sse` 或 `streamable_http` 时，`url` 必填
- `name` 在 `servers` 列表中必须唯一
- `env` 中的 `${VAR}` 语法在运行时从环境变量替换

### 4.3 环境变量替换

`env` 字段中的 `${VAR_NAME}` 语法在传递给子进程前从当前环境变量替换：

```python
# mcp/client.py MCPClient._create_transport() 中的环境变量处理

import os
import re

def _resolve_env(env: Dict[str, str]) -> Dict[str, str]:
    """替换 env 中的 ${VAR} 为环境变量值。

    未找到的环境变量保留原样（与 shell 行为一致）。
    """
    pattern = re.compile(r"\$\{(\w+)\}")
    resolved = {}
    for key, value in env.items():
        resolved[key] = pattern.sub(
            lambda m: os.environ.get(m.group(1), m.group(0)),
            value,
        )
    return resolved
```

### 4.4 配置文件示例

在 `MODU_CONFIG_PATH` 指向的 JSON 配置文件中添加 MCP 配置：

```json
{
    "mcp": {
        "enabled": true,
        "default_timeout": 30.0,
        "servers": [
            {
                "name": "github",
                "enabled": true,
                "transport": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github"],
                "env": {
                    "GITHUB_TOKEN": "${GITHUB_TOKEN}"
                },
                "auto_start": true
            },
            {
                "name": "filesystem",
                "enabled": true,
                "transport": "stdio",
                "command": "npx",
                "args": [
                    "-y",
                    "@modelcontextprotocol/server-filesystem",
                    "/tmp/workspace"
                ],
                "auto_start": true
            },
            {
                "name": "custom_api",
                "enabled": false,
                "transport": "sse",
                "url": "http://localhost:3001/sse"
            }
        ]
    }
}
```

### 4.5 运行时工具筛选

现有的 `configurable.tools` 参数（[factory.py L227](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/factory.py#L227)）已支持工具名筛选，MCP 工具使用全限定名：

```python
# 只使用 GitHub MCP 工具和内置计算器
graph = create_agent(config={
    "configurable": {
        "tools": ["github__search_repos", "github__get_file_contents", "calculator"]
    }
})
```

### 4.6 HITL 敏感工具配置

MCP 工具可通过名称加入 `tools.human_in_loop.sensitive_tools` 列表（[runtime_config.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/config/runtime_config.py) 中现有配置项）：

```json
{
    "tools": {
        "human_in_loop": {
            "enabled": true,
            "sensitive_tools": [
                "code_executor",
                "sql_query",
                "file_ops_write",
                "github__create_issue",
                "github__delete_repository"
            ]
        }
    }
}
```

`human_review_node` 中的 `_tool_requires_approval()` 会检查工具名是否在列表中，MCP 工具的全限定名同样生效。

---

## 五、落地步骤与架构图

### 5.1 落地步骤（5 个阶段）

#### 阶段 1：基础设施搭建（新增 `mcp/` 模块）

**新增文件**：
```
apps/backend/ModuAgent/mcp/
├── __init__.py        # 导出 MCPClient, get_mcp_client, reset_mcp_client
├── client.py          # MCPClient + MCPSession
├── transport.py       # Transport ABC + StdioTransport + SSETransport
├── discovery.py       # ToolInfo + ToolDiscovery
├── lifecycle.py       # ServerLifecycleManager
└── errors.py          # MCPError 层级
```

**新增依赖**：`apps/backend/ModuAgent/pyproject.toml` 中添加：
```toml
[project]
dependencies = [
    # ... 现有依赖 ...
    "mcp>=0.9.0",  # MCP Python SDK（可选，也可纯自研不依赖官方 SDK）
]
```

> **注意**：本方案设计了独立的 Transport 层实现（stdio pipe + SSE HTTP），可不完全依赖官方 `mcp` SDK。但建议安装官方 SDK 以获取协议兼容性验证和未来协议升级支持。

#### 阶段 2：适配器开发（新增 `mcp_tool_adapter.py`）

**新增文件**：
```
apps/backend/ModuAgent/modu_graph/adapters/mcp_tool_adapter.py
```

实现 `MCPToolAdapter(BaseTool)`，将 MCP 工具适配为 ModuAgent 内置工具接口。

**验收标准**：
- `MCPToolAdapter` 通过 `isinstance(tool, BaseTool)` 类型检查
- `register_tool(adapter)` 成功注册到 `ComponentRegistry`
- `wrap_modu_tool(adapter)` 成功包装为 `StructuredTool`
- LLM 能发现并调用 MCP 工具

#### 阶段 3：配置集成（修改 `runtime_config.py`）

**修改文件**：`config/runtime_config.py`

在 `_DEFAULT_CONFIG` 中新增 `mcp` 配置节（见 4.1 节）。

**验收标准**：
- `get_config().get("mcp.enabled")` 返回 `False`（默认关闭）
- `get_config().get("mcp.servers")` 返回空列表（默认无 Server）
- JSON 配置文件中的 `mcp` 配置被正确合并

#### 阶段 4：工厂集成（修改 `factory.py`）

**修改文件**：`modu_graph/factory.py` 的 `create_agent()` 函数

在 `build_langchain_tools()` 调用前插入 MCP 工具发现逻辑（见 3.3 节）。

**验收标准**：
- `mcp.enabled=False` 时行为与修改前完全一致（零侵入）
- `mcp.enabled=True` 且配置了 Server 时，MCP 工具自动发现并注册
- MCP Server 不可达时不阻断 Agent 启动（降级为无 MCP 工具）

#### 阶段 5：应用集成（修改 `agent_bridge.py` + `main.py`）

**修改文件**：
- `app/core/agent_bridge.py`：`_init_moduagent()` 末尾确保 mcp 模块可导入
- `app/main.py`：`lifespan` 中启动/停止 MCPClient

**验收标准**：
- 应用启动时自动连接配置的 MCP Server
- 应用关闭时自动断开所有 MCP 连接并停止子进程
- MCP 工具在 `/agent/completions` 流式响应中正常工作

### 5.2 完整架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Pioneering Backend (FastAPI)                       │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         app/main.py (lifespan)                         │  │
│  │  ┌─────────────┐          ┌──────────────────────────────────────┐   │  │
│  │  │  init_db()  │          │  MCPClient.start(config)  ← 新增      │   │  │
│  │  └─────────────┘          │  MCPClient.stop()       ← 新增      │   │  │
│  │                            └──────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│  ┌─────────────────────────────────▼────────────────────────────────────┐  │
│  │                    app/api/v1/agent.py                                │  │
│  │               POST /agent/completions (SSE)                           │  │
│  └─────────────────────────────────┬────────────────────────────────────┘  │
│                                    │                                        │
│  ┌─────────────────────────────────▼────────────────────────────────────┐  │
│  │              app/core/agent_bridge.py                                  │  │
│  │  ┌──────────────────┐    ┌──────────────────────────────────────┐    │  │
│  │  │ _init_moduagent()│    │ stream_agent_completion()             │    │  │
│  │  │ 注册 7 个内置工具 │    │   → create_agent()                    │    │  │
│  │  └──────────────────┘    │   → graph.astream()                   │    │  │
│  └──────────────────────────┴───────────┬──────────────────────────┘    │  │
│                                           │                                 │
│  ┌───────────────────────────────────────▼──────────────────────────┐   │
│  │                    ModuAgent Framework                            │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐    │   │
│  │  │              modu_graph/factory.py                       │    │   │
│  │  │                                                          │    │   │
│  │  │  create_agent():                                         │    │   │
│  │  │    1. build_chat_model()      ← LLM 构造                 │    │   │
│  │  │    2. [新增] MCP 工具发现      ← MCPClient.list_all_tools │    │   │
│  │  │       └─ MCPToolAdapter      ← BaseTool 适配             │    │   │
│  │  │       └─ registry.register_tool()                        │    │   │
│  │  │    3. build_langchain_tools() ← 从 registry 取全部工具    │    │   │
│  │  │       ├─ CalculatorTool (内置)                           │    │   │
│  │  │       ├─ SearchTool (内置)                               │    │   │
│  │  │       ├─ CodeExecutorTool (内置)                         │    │   │
│  │  │       └─ MCPToolAdapter (MCP远程) ← 新增                  │    │   │
│  │  │    4. llm.bind_tools(tools)  ← 绑定到 LLM                │    │   │
│  │  │    5. build_modu_graph()     ← 构建图                    │    │   │
│  │  └──────────────────────────────────────────────────────────┘    │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐    │   │
│  │  │              modu_graph/graph.py                         │    │   │
│  │  │                                                          │    │   │
│  │  │  START → perception → memory_query → agent              │    │   │
│  │  │                                            │             │    │   │
│  │  │                              ┌─────────────┘             │    │   │
│  │  │                              ▼                           │    │   │
│  │  │                    route_after_agent                      │    │   │
│  │  │                     ├─ tool_calls?                       │    │   │
│  │  │                     │   ├─ Yes → human_review (HITL)    │    │   │
│  │  │                     │   │         → tools → ToolNode     │    │   │
│  │  │                     │   │              │                │    │   │
│  │  │                     │   │              ▼                │    │   │
│  │  │                     │   │     StructuredTool._invoke()  │    │   │
│  │  │                     │   │       ├─ CalculatorTool.invoke (进程内) │
│  │  │                     │   │       ├─ MCPToolAdapter.invoke (远程) │
│  │  │                     │   │       │     └─ MCPClient.call_tool() │
│  │  │                     │   │       │         └─ MCPSession.call_tool() │
│  │  │                     │   │       │             └─ Transport.request() │
│  │  │                     │   │       │                 └─ JSON-RPC     │
│  │  │                     │   │       └─ tool_result_processor          │
│  │  │                     │   │             └─ agent (ReAct 循环)       │
│  │  │                     │   └─ No → response → feedback → END        │
│  │  └──────────────────────────────────────────────────────────┘    │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐    │   │
│  │  │  mcp/ (新增)                                             │    │   │
│  │  │  ┌───────────┐  ┌──────────────┐  ┌────────────────┐   │    │   │
│  │  │  │ MCPClient  │  │ MCPSession   │  │ Transport      │   │    │   │
│  │  │  │ (单例)     │  │ (per-Server) │  │ (stdio/SSE)    │   │    │   │
│  │  │  └─────┬─────┘  └──────┬───────┘  └───────┬────────┘   │    │   │
│  │  │        │               │                  │             │    │   │
│  │  │  ┌─────▼─────┐  ┌──────▼───────┐  ┌───────▼────────┐   │    │   │
│  │  │  │ Discovery  │  │ Lifecycle   │  │ Errors         │   │    │   │
│  │  │  │ (工具缓存)  │  │ (进程管理)   │  │ (MCP_001~004) │   │    │   │
│  │  │  └───────────┘  └──────────────┘  └────────────────┘   │    │   │
│  │  └──────────────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     外部 MCP Server 进程                          │   │
│  │                                                                 │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │   │
│  │  │ GitHub MCP   │  │ Filesystem   │  │ Custom API MCP       │   │   │
│  │  │ Server       │  │ MCP Server   │  │ Server (SSE)         │   │   │
│  │  │              │  │              │  │                      │   │   │
│  │  │ tools:       │  │ tools:       │  │ tools:               │   │   │
│  │  │  search_repos│  │  read_file   │  │  query_data          │   │   │
│  │  │  get_file    │  │  write_file  │  │  submit_form         │   │   │
│  │  │  create_issue│  │  list_dir    │  │                      │   │   │
│  │  │              │  │              │  │                      │   │   │
│  │  │ (stdio pipe) │  │ (stdio pipe) │  │ (HTTP SSE)           │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.3 文件变更清单

| 操作 | 文件路径 | 变更内容 |
|------|---------|---------|
| **新增** | `ModuAgent/mcp/__init__.py` | 导出公共 API |
| **新增** | `ModuAgent/mcp/client.py` | MCPClient + MCPSession |
| **新增** | `ModuAgent/mcp/transport.py` | Transport ABC + Stdio/SSE 实现 |
| **新增** | `ModuAgent/mcp/discovery.py` | ToolInfo + ToolDiscovery |
| **新增** | `ModuAgent/mcp/lifecycle.py` | ServerLifecycleManager |
| **新增** | `ModuAgent/mcp/errors.py` | MCPError 层级 |
| **新增** | `ModuAgent/modu_graph/adapters/mcp_tool_adapter.py` | MCPToolAdapter(BaseTool) |
| **修改** | `ModuAgent/config/runtime_config.py` | `_DEFAULT_CONFIG` 新增 `mcp` 配置节 |
| **修改** | `ModuAgent/modu_graph/factory.py` | `create_agent()` 新增 MCP 工具发现段 |
| **修改** | `app/core/agent_bridge.py` | `_init_moduagent()` 末尾确保 mcp 模块可导入 |
| **修改** | `app/main.py` | `lifespan` 新增 MCPClient 启动/停止 |
| **修改** | `ModuAgent/pyproject.toml` | 新增 `mcp>=0.9.0` 依赖（可选） |

### 5.4 低侵入性保证

| 原有模块 | 是否修改 | 修改程度 | 说明 |
|---------|---------|---------|------|
| `core/interfaces/action.py` (BaseTool) | ❌ 不修改 | - | MCPToolAdapter 实现 BaseTool 即可 |
| `core/registry.py` (ComponentRegistry) | ❌ 不修改 | - | MCP 工具走 `register_tool()` 现有路径 |
| `modu_graph/adapters/tool_adapter.py` | ❌ 不修改 | - | `wrap_modu_tool()` 对 MCPToolAdapter 同样生效 |
| `modu_graph/nodes.py` (图节点) | ❌ 不修改 | - | ToolNode/human_review_node 对 MCP 工具透明 |
| `modu_graph/graph.py` (图构建) | ❌ 不修改 | - | 图结构不变，MCP 工具混入 tools 列表 |
| `modu_graph/runner.py` (运行器) | ❌ 不修改 | - | 流式/非流式运行对 MCP 工具透明 |
| `modu_graph/factory.py` (工厂) | ✅ 修改 | ~15 行新增 | MCP 工具发现段（try/except 隔离） |
| `config/runtime_config.py` (配置) | ✅ 修改 | ~25 行新增 | `mcp` 配置节 |
| `app/core/agent_bridge.py` (桥接) | ✅ 修改 | ~5 行新增 | 模块可导入性检查 |
| `app/main.py` (入口) | ✅ 修改 | ~10 行新增 | lifespan 中 MCPClient 启停 |

**核心修改仅 ~55 行**，全部集中在工厂函数和配置中。图节点、注册表、适配器等核心模块**零修改**。

### 5.5 高扩展性保证

| 扩展场景 | 是否需要修改核心代码 | 扩展方式 |
|---------|-------------------|---------|
| 新增 MCP Server | ❌ | 在配置文件中添加 server 条目 |
| 新增传输协议（如 WebSocket） | ❌ | 新增 Transport 子类，在 `_create_transport` 中注册 |
| MCP 工具权限控制 | ❌ | 在 `sensitive_tools` 配置中添加工具全限定名 |
| MCP 工具重试 | ❌ | `with_tool_retry()` 自动包装（由 tool_adapter 触发） |
| MCP 工具事件发布 | ❌ | event_bridge 自动发布 TOOL.INVOKE/EXECUTE 事件 |
| MCP Server 动态热加载 | ✅ 轻量 | 调用 `MCPClient.start(new_config)` + `registry.register_tool()` |
| MCP Resource 读取 | ✅ 新增 | 新增 `MCPResourceAdapter`，可注册为特殊工具 |
| MCP Prompt 模板 | ✅ 新增 | 新增 `MCPPromptAdapter`，可注入 system_prompt |
