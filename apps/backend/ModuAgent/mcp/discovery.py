"""MCP 工具发现与缓存。

从 MCP Server 的 ``tools/list`` 响应解析工具元信息，
提供缓存、查询能力，供 MCPToolAdapter 使用。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ToolInfo:
    """MCP 工具元信息（从 tools/list 响应解析）。

    字段对应 MCP 规范的 Tool 定义。

    Attributes:
        server_name: 来源 Server 名
        raw_name: Server 内工具名
        description: 工具描述
        input_schema: JSON Schema 参数定义
    """

    server_name: str
    raw_name: str
    description: str = ""
    input_schema: Dict[str, Any] = field(default_factory=dict)

    @property
    def qualified_name(self) -> str:
        """全限定名：``server_name__raw_name``（避免跨 Server 工具名冲突）。"""
        return f"{self.server_name}__{self.raw_name}"

    @classmethod
    def from_mcp_dict(cls, server_name: str, raw: Dict[str, Any]) -> ToolInfo:
        """从 MCP ``tools/list`` 响应项构建 ToolInfo。

        Args:
            server_name: 来源 Server 名
            raw: MCP 响应中的单个工具字典

        Returns:
            ToolInfo 实例
        """
        return cls(
            server_name=server_name,
            raw_name=raw.get("name", ""),
            description=raw.get("description", ""),
            input_schema=raw.get("inputSchema", {}) or raw.get("input_schema", {}),
        )

    def to_base_tool_schema(self) -> Dict[str, Any]:
        """转换为 ModuAgent ``BaseTool.parameters_schema()`` 格式。

        MCP 的 inputSchema 已是标准 JSON Schema，
        直接返回即可。
        """
        return self.input_schema if self.input_schema else {
            "type": "object",
            "properties": {},
            "additionalProperties": True,
        }


class ToolDiscovery:
    """工具发现服务。

    提供工具发现、缓存、查询能力。
    由 MCPClient 调用，不直接持有 transport。
    """

    def __init__(self) -> None:
        self._cache: Dict[str, List[ToolInfo]] = {}  # server_name → tools

    def update(self, server_name: str, tools: List[ToolInfo]) -> None:
        """更新指定 Server 的工具缓存。

        Args:
            server_name: Server 名
            tools: 工具列表
        """
        self._cache[server_name] = tools
        logger.info("Tool cache updated: server=%s, count=%d", server_name, len(tools))

    def get_all(self) -> List[ToolInfo]:
        """返回所有缓存工具。

        Returns:
            全部 Server 的工具列表
        """
        all_tools: List[ToolInfo] = []
        for tools in self._cache.values():
            all_tools.extend(tools)
        return all_tools

    def get_by_server(self, server_name: str) -> List[ToolInfo]:
        """返回指定 Server 的工具。

        Args:
            server_name: Server 名

        Returns:
            该 Server 的工具列表（可能为空）
        """
        return self._cache.get(server_name, [])

    def find_by_name(self, tool_name: str) -> Optional[ToolInfo]:
        """按全限定名或裸名查找工具。

        优先匹配全限定名，其次裸名（首个命中）。

        Args:
            tool_name: 全限定名或裸名

        Returns:
            ToolInfo 实例，或 None
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
