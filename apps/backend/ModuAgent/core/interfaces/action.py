from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BaseActionExecutor(ABC):
    @abstractmethod
    def execute(
        self,
        action_name: str,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        pass

    @abstractmethod
    def list_actions(self) -> List[str]:
        pass


class BaseTool(ABC):
    @abstractmethod
    def name(self) -> str:
        pass

    @abstractmethod
    def description(self) -> str:
        pass

    @abstractmethod
    def parameters_schema(self) -> Dict:
        pass

    @abstractmethod
    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        pass

    # === P3-12.3.2 Human-in-the-loop ===

    def requires_approval(self) -> bool:
        """是否需要人工审批（默认 False，敏感工具覆写为 True）。

        Returns:
            bool: True 表示该工具的调用需人工审批后才能执行
        """
        return False

    def on_approval_rejected(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """审批拒绝时返回的降级结果。

        默认实现返回标准化错误结构；敏感工具可覆写以提供更友好的降级响应。

        Args:
            params: 原始工具调用参数

        Returns:
            降级响应字典，结构为 {"status": "error", "error_code": str, "data": {...}}
        """
        return {
            "status": "error",
            "error_code": "TOOL_APPROVAL_REJECTED",
            "data": {"message": "Tool execution rejected by human reviewer"},
        }
