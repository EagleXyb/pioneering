from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class DelegationPattern:
    """按领域委托模式（P2-11 评估：未集成，保留为参考实现）。

    现状：
        - 未被任何生产 API 或 LangGraph 编排流程引用
        - 功能与 LangGraph 的条件路由（conditional_edges）重叠，
          但提供了动态注册/注销领域处理器的灵活性

    未来迁移方向（超出 P2-11 范围）：
        - 迁移为 LangGraph Subgraph，每个领域对应一个子图
        - 路由函数基于输入的 domain 字段选择对应子图
        - 利用 LangGraph 的 Store 实现领域处理器的动态注册
    """

    def __init__(self):
        self._delegates: Dict[str, Callable[[Dict[str, Any]], Any]] = {}

    def register_delegate(
        self,
        domain: str,
        handler: Callable[[Dict[str, Any]], Any],
    ) -> None:
        self._delegates[domain] = handler
        logger.info("Registered delegate for domain: %s", domain)

    def unregister_delegate(self, domain: str) -> None:
        if domain in self._delegates:
            del self._delegates[domain]
            logger.info("Unregistered delegate for domain: %s", domain)

    async def delegate(
        self,
        domain: str,
        task_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        handler = self._delegates.get(domain)
        if handler is None:
            return {
                "status": "error",
                "error_code": "DELEGATION_001",
                "data": {"message": f"No delegate registered for domain: {domain}"},
            }
        try:
            import asyncio
            if asyncio.iscoroutinefunction(handler):
                result = await handler(task_data)
            else:
                result = handler(task_data)
            if isinstance(result, dict):
                return result
            return {"status": "success", "error_code": "", "data": {"result": result}}
        except Exception as e:
            logger.error("Delegation error for domain %s: %s", domain, str(e))
            return {
                "status": "error",
                "error_code": "DELEGATION_002",
                "data": {"message": str(e)},
            }

    def list_delegates(self) -> List[str]:
        return list(self._delegates.keys())
