from __future__ import annotations

import logging
import re
from typing import Any, Dict

from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)

_EXPRESSION_PATTERN = re.compile(r"^[0-9+\-*/\s().]+$")


class CalculatorTool(BaseTool):
    def name(self) -> str:
        return "calculator"

    def description(self) -> str:
        return "计算数学表达式，仅支持加减乘除和括号运算"

    def parameters_schema(self) -> Dict:
        return {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "数学表达式（仅支持+-*/和括号）",
                    "pattern": r"^[0-9+\-*/\\s().]+$",
                },
            },
            "required": ["expression"],
        }

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        expression = params.get("expression", "")

        if not isinstance(expression, str) or not expression.strip():
            return {
                "status": "error",
                "error_code": "TOOL_001",
                "data": {"message": "表达式不能为空"},
            }

        expression = expression.strip()

        if not _EXPRESSION_PATTERN.match(expression):
            return {
                "status": "error",
                "error_code": "TOOL_001",
                "data": {"message": "非法表达式，仅允许数字和+-*/()"},
            }

        try:
            result = self._safe_eval(expression)
            return {
                "status": "success",
                "error_code": "",
                "data": {"result": result, "expression": expression},
            }
        except ZeroDivisionError:
            return {
                "status": "error",
                "error_code": "TOOL_002",
                "data": {"message": "除零错误"},
            }
        except Exception as e:
            logger.error("CalculatorTool eval error: %s - %s", expression, str(e))
            return {
                "status": "error",
                "error_code": "TOOL_002",
                "data": {"message": f"计算错误: {e}"},
            }

    @staticmethod
    def _safe_eval(expression: str) -> float:
        allowed_chars = set("0123456789+-*/(). ")
        if not all(c in allowed_chars for c in expression):
            raise ValueError(f"Disallowed character in expression: {expression}")

        compiled = compile(expression, "<calculator>", "eval")
        result = eval(compiled, {"__builtins__": {}}, {})  # noqa: S307
        return float(result)
