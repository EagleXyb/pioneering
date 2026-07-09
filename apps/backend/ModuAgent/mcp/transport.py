"""MCP 传输层抽象与实现。

封装 stdio / SSE 两种 MCP 传输协议，
使上层 MCPSession 无需感知底层传输细节。

设计原则：
    - 所有传输方式实现统一的 request / notify 接口
    - 异步优先（asyncio），与 LangGraph 的 astream 一致
    - 单个传输失败不影响其他传输
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# JSON-RPC 消息分隔符（MCP stdio 协议使用换行分隔）
_JSONRPC_DELIMITER = "\n"


class Transport(ABC):
    """MCP 传输层抽象基类。

    所有传输方式实现统一的 request / notify 接口，
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
            method: MCP 方法名（如 ``tools/list``、``tools/call``）
            params: 方法参数

        Returns:
            JSON-RPC 响应的 ``result`` 字段

        Raises:
            MCPProtocolError: Server 返回 JSON-RPC error
        """
        ...

    @abstractmethod
    async def notify(self, method: str, params: Dict[str, Any]) -> None:
        """发送 JSON-RPC 通知（无响应）。

        Args:
            method: MCP 方法名
            params: 方法参数
        """
        ...

    @property
    @abstractmethod
    def connected(self) -> bool:
        """是否已连接。"""
        ...


def _resolve_env(env: Dict[str, str]) -> Dict[str, str]:
    """替换 env 中的 ``${VAR}`` 为环境变量值。

    未找到的环境变量保留原样（与 shell 行为一致）。

    Args:
        env: 原始环境变量字典

    Returns:
        替换后的环境变量字典
    """
    pattern = re.compile(r"\$\{(\w+)\}")
    resolved: Dict[str, str] = {}
    for key, value in env.items():
        resolved[key] = pattern.sub(
            lambda m: os.environ.get(m.group(1), m.group(0)),
            value,
        )
    return resolved


class StdioTransport(Transport):
    """stdio 传输：通过子进程 stdin/stdout 通信。

    最常用的 MCP 传输方式，Server 作为子进程运行。
    使用 JSON-RPC over newline-delimited stdio 协议。
    """

    def __init__(
        self,
        command: str,
        args: Optional[List[str]] = None,
        env: Optional[Dict[str, str]] = None,
        cwd: Optional[str] = None,
    ) -> None:
        self._command = command
        self._args = args or []
        # 合并环境变量：当前进程环境 + 额外配置（含 ${VAR} 替换）
        self._env = {**os.environ, **_resolve_env(env or {})}
        self._cwd = cwd
        self._process: Optional[asyncio.subprocess.Process] = None
        self._request_id = 0
        self._pending: Dict[int, asyncio.Future[Dict[str, Any]]] = {}
        self._read_task: Optional[asyncio.Task[None]] = None
        self._connected = False

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
        self._connected = True
        # 启动后台读取循环
        self._read_task = asyncio.create_task(self._read_loop())
        logger.info(
            "StdioTransport connected: command=%s args=%s",
            self._command, self._args,
        )

    async def disconnect(self) -> None:
        """终止子进程。"""
        self._connected = False
        if self._read_task and not self._read_task.done():
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._process.kill()
                await self._process.wait()
        self._process = None
        # 取消所有 pending futures
        for future in self._pending.values():
            if not future.done():
                future.cancel()
        self._pending.clear()

    async def request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """发送 JSON-RPC 请求并等待响应。"""
        if not self._connected or self._process is None or self._process.stdin is None:
            from mcp.errors import MCPConnectionError
            raise MCPConnectionError("StdioTransport not connected")

        self._request_id += 1
        req_id = self._request_id
        msg = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params,
        }

        loop = asyncio.get_event_loop()
        future: asyncio.Future[Dict[str, Any]] = loop.create_future()
        self._pending[req_id] = future

        data = (json.dumps(msg) + _JSONRPC_DELIMITER).encode()
        self._process.stdin.write(data)
        await self._process.stdin.drain()

        return await future

    async def notify(self, method: str, params: Dict[str, Any]) -> None:
        """发送 JSON-RPC 通知（无响应）。"""
        if not self._connected or self._process is None or self._process.stdin is None:
            from mcp.errors import MCPConnectionError
            raise MCPConnectionError("StdioTransport not connected")

        msg = {"jsonrpc": "2.0", "method": method, "params": params}
        data = (json.dumps(msg) + _JSONRPC_DELIMITER).encode()
        self._process.stdin.write(data)
        await self._process.stdin.drain()

    async def _read_loop(self) -> None:
        """后台读取子进程 stdout，按行解析 JSON-RPC 消息。"""
        from mcp.errors import MCPProtocolError

        while self._connected and self._process and self._process.stdout:
            try:
                line = await self._process.stdout.readline()
                if not line:
                    break
                msg = json.loads(line.decode())
                req_id = msg.get("id")
                if req_id is not None and req_id in self._pending:
                    future = self._pending.pop(req_id)
                    if future.done():
                        continue
                    if "error" in msg:
                        err = msg["error"]
                        future.set_exception(
                            MCPProtocolError(
                                f"MCP error {err.get('code')}: {err.get('message', '')}"
                            )
                        )
                    else:
                        future.set_result(msg.get("result", {}))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue  # 跳过非 JSON 行
            except asyncio.CancelledError:
                break
            except Exception as e:  # noqa: BLE001
                logger.error("StdioTransport read loop error: %s", e)
                break

    @property
    def connected(self) -> bool:
        return self._connected


class SSETransport(Transport):
    """SSE / streamable_http 传输：通过 HTTP 连接远程 Server。

    使用 httpx.AsyncClient 发送 JSON-RPC 请求。
    """

    def __init__(self, url: str, timeout: float = 30.0) -> None:
        self._url = url
        self._timeout = timeout
        self._client: Optional[Any] = None  # httpx.AsyncClient
        self._connected = False

    async def connect(self) -> None:
        """建立 HTTP 客户端连接。"""
        try:
            import httpx
        except ImportError as e:
            raise ImportError("httpx is required for SSE transport: %s" % e) from e

        self._client = httpx.AsyncClient(
            base_url=self._url,
            timeout=httpx.Timeout(self._timeout),
        )
        self._connected = True
        logger.info("SSETransport connected: url=%s", self._url)

    async def disconnect(self) -> None:
        """关闭 HTTP 客户端。"""
        self._connected = False
        if self._client:
            await self._client.aclose()
            self._client = None

    async def request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """发送 JSON-RPC POST 请求并等待响应。"""
        from mcp.errors import MCPConnectionError, MCPProtocolError

        if not self._connected or self._client is None:
            raise MCPConnectionError("SSETransport not connected")

        msg = {
            "jsonrpc": "2.0",
            "id": id(msg := object()),  # 唯一 ID
            "method": method,
            "params": params,
        }
        try:
            resp = await self._client.post("/", json=msg)
            resp.raise_for_status()
        except Exception as e:
            raise MCPConnectionError(f"SSE request failed: {e}") from e

        data = resp.json()
        if "error" in data:
            err = data["error"]
            raise MCPProtocolError(
                f"MCP error {err.get('code')}: {err.get('message', '')}"
            )
        return data.get("result", {})

    async def notify(self, method: str, params: Dict[str, Any]) -> None:
        """发送 JSON-RPC 通知。"""
        from mcp.errors import MCPConnectionError

        if not self._connected or self._client is None:
            raise MCPConnectionError("SSETransport not connected")

        msg = {"jsonrpc": "2.0", "method": method, "params": params}
        await self._client.post("/", json=msg)

    @property
    def connected(self) -> bool:
        return self._connected
