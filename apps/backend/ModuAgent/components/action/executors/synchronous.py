from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from core.interfaces.action import BaseActionExecutor
from core.registry import ComponentRegistry, get_registry

logger = logging.getLogger(__name__)


class SyncActionExecutor(BaseActionExecutor):
    def __init__(self, registry: Optional[ComponentRegistry] = None) -> None:
        self._registry = registry or get_registry()

    def execute(
        self,
        action_name: str,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        tool = self._registry.get_tool(action_name)
        if tool is None:
            logger.error("Tool not found: %s", action_name)
            return {
                "status": "error",
                "error_code": "TOOL_001",
                "data": {"message": f"Tool not found: {action_name}"},
            }

        try:
            result = tool.invoke(params=params, context=context)
            logger.debug("Tool executed: %s", action_name)
            return result
        except Exception as e:
            logger.error("Tool execution error: %s - %s", action_name, str(e))
            return {
                "status": "error",
                "error_code": "TOOL_002",
                "data": {"message": f"Tool execution failed: {e}"},
            }

    def list_actions(self) -> List[str]:
        return list(self._registry.list_tools().keys())
