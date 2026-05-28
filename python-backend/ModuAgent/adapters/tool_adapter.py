from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from core.interfaces.action import BaseTool
from core.registry import get_registry
from orchestration.communication.protocol import ErrorCode

logger = logging.getLogger(__name__)


class ToolAdapter:
    def __init__(self):
        self._registry = get_registry()

    def invoke_tool(
        self,
        tool_name: str,
        params: Dict[str, Any],
        context: Dict[str, Any],
        timeout_ms: int = 3000,
        required_fields: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        tool = self._registry.get_tool(tool_name)
        if tool is None:
            return {
                "status": "error",
                "error_code": ErrorCode.TOOL_PARAMETER_INVALID,
                "data": {"message": f"Tool not found: {tool_name}"},
            }

        schema = tool.parameters_schema()
        validation_error = self._validate_params(params, schema)
        if validation_error:
            return {
                "status": "error",
                "error_code": ErrorCode.TOOL_PARAMETER_INVALID,
                "data": {"message": validation_error},
            }

        try:
            result = tool.invoke(params=params, context=context)
        except Exception as e:
            logger.error("Tool invocation error: %s - %s", tool_name, str(e))
            return {
                "status": "error",
                "error_code": ErrorCode.TOOL_SERVICE_TIMEOUT,
                "data": {"message": str(e)},
            }

        if required_fields:
            missing = [f for f in required_fields if f not in result.get("data", {})]
            if missing:
                return {
                    "status": "error",
                    "error_code": ErrorCode.TOOL_PARAMETER_INVALID,
                    "data": {"message": f"Missing required fields: {missing}"},
                }

        return result

    def list_available_tools(self) -> Dict[str, Dict[str, Any]]:
        return self._registry.list_tools()

    def _validate_params(
        self,
        params: Dict[str, Any],
        schema: Dict,
    ) -> Optional[str]:
        required = schema.get("required", [])
        properties = schema.get("properties", {})

        for field_name in required:
            if field_name not in params:
                return f"Missing required parameter: {field_name}"

        for key, value in params.items():
            if key in properties:
                expected_type = properties[key].get("type")
                if expected_type and not self._check_type(value, expected_type):
                    return f"Parameter '{key}' expected type {expected_type}, got {type(value).__name__}"

        return None

    @staticmethod
    def _check_type(value: Any, expected_type: str) -> bool:
        type_map = {
            "string": str,
            "integer": int,
            "number": (int, float),
            "boolean": bool,
            "array": list,
            "object": dict,
        }
        expected = type_map.get(expected_type)
        if expected is None:
            return True
        return isinstance(value, expected)
