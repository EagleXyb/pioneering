from __future__ import annotations

import concurrent.futures
import logging
from typing import Any, Dict, List, Optional

from core.interfaces.action import BaseTool
from core.registry import get_registry
from orchestration.communication.protocol import ErrorCode

logger = logging.getLogger(__name__)


class ToolAdapter:
    def __init__(self, max_workers: int = 8):
        self._registry = get_registry()
        # P1-4: 实例级线程池复用，避免每次调用创建/销毁开销
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)

    def close(self) -> None:
        """释放线程池资源。"""
        self._executor.shutdown(wait=False)

    def __del__(self) -> None:
        try:
            self._executor.shutdown(wait=False)
        except Exception:
            pass

    def invoke_tool(
        self,
        tool_name: str,
        params: Dict[str, Any],
        context: Dict[str, Any],
        timeout_ms: int = 1800000,
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
            # P1-4: 复用实例级线程池
            future = self._executor.submit(tool.invoke, params=params, context=context)
            result = future.result(timeout=timeout_ms / 1000.0)
        except concurrent.futures.TimeoutError:
            logger.error("Tool execution timeout: %s (timeout=%dms)", tool_name, timeout_ms)
            return {
                "status": "error",
                "error_code": ErrorCode.TOOL_SERVICE_TIMEOUT,
                "data": {"message": f"Tool execution timed out after {timeout_ms}ms: {tool_name}"},
            }
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
