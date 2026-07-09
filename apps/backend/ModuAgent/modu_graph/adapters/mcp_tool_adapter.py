"""MCP Tool → ModuAgent BaseTool 适配器。

将 MCP 远程工具适配为 ModuAgent ``BaseTool`` 接口，
使 LangGraph 的 ToolNode 可无感调用。

设计原则：
    - 零侵入：MCP 工具适配为 BaseTool 子类后，与内置工具
      （calculator/search/code_executor 等）在 registry 和图中无差异。
    - 异步转同步：LangGraph ToolNode 调用 StructuredTool 的同步 _invoke，
      适配器内部通过事件循环将 MCP 异步调用桥接为同步。
    - 复用现有基础设施：HITL 审批、重试、事件发布等机制对 MCP 工具同样生效。

调用链路::

    ToolNode → StructuredTool._invoke → MCPToolAdapter.invoke
    → MCPClient.call_tool → MCPSession.call_tool → Transport.request
    → JSON-RPC → MCP Server → 返回结果
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
    注册到 ComponentRegistry 后，``build_langchain_tools()`` 自动取出，
    经 ``wrap_modu_tool()`` 包装为 StructuredTool，绑定到 LLM。

    Attributes:
        _tool_info: MCP 工具元信息
        _mcp_client: MCP 客户端单例
    """

    def __init__(self, tool_info: ToolInfo) -> None:
        self._tool_info = tool_info
        self._mcp_client = get_mcp_client()

    def name(self) -> str:
        """工具全限定名（``server_name__raw_name``）。

        使用全限定名避免不同 Server 的同名工具冲突。
        """
        return self._tool_info.qualified_name

    def description(self) -> str:
        """工具描述（来自 MCP Server 的 tools/list 响应）。

        在描述前缀中标注来源 Server，便于 LLM 区分工具来源。
        """
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
        使用 ``asyncio.run()`` 在当前线程创建事件循环。

        返回结构与内置工具一致：``{"status": "success/error", "data": {...}}``

        Args:
            params: 工具参数
            context: 调用上下文（当前未使用，保留接口兼容）

        Returns:
            标准化的工具执行结果
        """
        try:
            result = self._run_async(params)
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

    def _run_async(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行异步 MCP 调用。

        优先复用当前事件循环（若在异步上下文中），
        否则创建新事件循环。
        """
        try:
            loop = asyncio.get_running_loop()
            # 在运行中的事件循环内，使用 ensure_future
            future = asyncio.ensure_future(self._invoke_async(params))
            return loop.run_until_complete(future)
        except RuntimeError:
            # 没有运行中的事件循环，创建新的
            return asyncio.run(self._invoke_async(params))

    async def _invoke_async(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """异步调用 MCP 工具。

        Args:
            params: 工具参数

        Returns:
            MCP 标准返回格式
        """
        return await self._mcp_client.call_tool(
            tool_name=self._tool_info.qualified_name,
            arguments=params,
            timeout=30.0,
        )

    def _format_result(self, mcp_result: Dict[str, Any]) -> Dict[str, Any]:
        """将 MCP 返回格式转换为 ModuAgent 标准结构。

        MCP 返回格式::

            {"content": [{"type": "text", "text": "..."}], "isError": false}

        ModuAgent 标准结构::

            {"status": "success", "data": {"result": ...}}

        Args:
            mcp_result: MCP 原始返回

        Returns:
            ModuAgent 标准结构
        """
        is_error = mcp_result.get("isError", False)
        content = mcp_result.get("content", [])

        # 提取文本内容
        text_parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text_parts.append(item.get("text", ""))

        result_text = "\n".join(text_parts) if text_parts else json.dumps(
            mcp_result, ensure_ascii=False
        )

        if is_error:
            return {
                "status": "error",
                "error_code": "MCP_004",
                "data": {"message": result_text, "tool": self.name()},
            }

        return {
            "status": "success",
            "data": {
                "result": result_text,
                "source": "mcp",
                "server": self._tool_info.server_name,
            },
        }

    def requires_approval(self) -> bool:
        """MCP 工具默认不需要审批。

        可通过配置 ``tools.human_in_loop.sensitive_tools`` 指定
        特定 MCP 工具名需审批（由 ``human_review_node`` 的
        ``_tool_requires_approval`` 检查）。

        Returns:
            False（默认不需要审批）
        """
        return False
