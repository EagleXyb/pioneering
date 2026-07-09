"""MCP Server 子进程生命周期管理。

仅对 ``transport=stdio`` 且 ``auto_start=True`` 的 Server 生效。
SSE/HTTP 类型的 Server 由远程管理，此处不涉及。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class ServerLifecycleManager:
    """MCP Server 子进程生命周期管理。

    StdioTransport.connect() 内部会启动子进程，
    此类作为辅助管理器，跟踪进程状态并提供健康检查。
    """

    def __init__(self) -> None:
        self._tracked: Dict[str, bool] = {}  # server_name → tracked

    def track(self, name: str) -> None:
        """标记一个 Server 为已跟踪。

        Args:
            name: Server 名
        """
        self._tracked[name] = True
        logger.debug("Server '%s' lifecycle tracked", name)

    async def stop_server(self, name: str) -> None:
        """标记 Server 已停止。

        实际子进程终止由 StdioTransport.disconnect() 负责。
        此方法仅清理跟踪状态。

        Args:
            name: Server 名
        """
        self._tracked.pop(name, None)
        logger.info("Server '%s' lifecycle stopped", name)

    async def stop_all(self) -> None:
        """停止所有已跟踪的 Server。"""
        names = list(self._tracked.keys())
        for name in names:
            await self.stop_server(name)

    def is_tracked(self, name: str) -> bool:
        """检查 Server 是否被跟踪。

        Args:
            name: Server 名

        Returns:
            True 表示被跟踪
        """
        return self._tracked.get(name, False)

    @property
    def tracked_servers(self) -> Dict[str, bool]:
        """返回已跟踪 Server 的快照。"""
        return dict(self._tracked)
