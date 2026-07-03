"""P3-12.3.4: 代码执行工具（AST 白名单沙箱 + 子进程隔离）。

安全策略（多层防御）：
    1. AST 白名单：拒绝 import / eval / exec / compile / open / __import__ 等危险节点
    2. 子进程隔离：在独立进程中执行，超时强制终止
    3. 最小环境：仅保留 PATH，禁用用户站点包（``-I`` 模式）
    4. 资源限制：超时 10s（可配），stdout/stderr 截断 4KB

需要人工审批（``requires_approval() = True``），仅在 HITL 开启时生效。
"""
from __future__ import annotations

import ast
import logging
import os
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Tuple

from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)


# AST 节点白名单：仅允许表达式/赋值/控制流/函数定义等安全节点
_ALLOWED_NODES: Tuple[type, ...] = (
    ast.Module,
    ast.FunctionDef,
    ast.AsyncFunctionDef,
    ast.ClassDef,
    ast.Return,
    ast.Assign,
    ast.AugAssign,
    ast.AnnAssign,
    ast.If,
    ast.For,
    ast.While,
    ast.Break,
    ast.Continue,
    ast.BoolOp,
    ast.BinOp,
    ast.UnaryOp,
    ast.Compare,
    ast.Call,
    ast.Constant,
    ast.Name,
    ast.List,
    ast.Tuple,
    ast.Dict,
    ast.Set,
    ast.ListComp,
    ast.SetComp,
    ast.DictComp,
    ast.GeneratorExp,
    ast.Attribute,
    ast.Subscript,
    ast.Starred,
    ast.Slice,
    ast.arguments,
    ast.arg,
    ast.keyword,
    ast.comprehension,
    ast.Lambda,
    ast.IfExp,
    ast.Expr,
    ast.Pass,
    ast.Index,  # Python < 3.9 兼容
    ast.Slice,
)

# 禁止的标识符名称（即使 AST 类型允许，名称危险也拒绝）
_FORBIDDEN_NAMES: set = {
    "__import__", "eval", "exec", "compile", "open", "input",
    "globals", "locals", "vars", "dir", "getattr", "setattr",
    "delattr", "__builtins__", "subprocess", "os", "sys",
    "shutil", "pathlib", "ctypes", "pickle", "marshal",
    "importlib", "__builtins__",
}

# 禁止的属性访问名（防止 .__class__.__bases__ 等元类逃逸）
_FORBIDDEN_ATTRS: set = {
    "__class__", "__bases__", "__subclasses__", "__mro__",
    "__globals__", "__builtins__", "__dict__", "__code__",
    "__module__", "__import__",
}


class CodeValidator(ast.NodeVisitor):
    """AST 校验器：拒绝所有不在白名单的节点与禁止的标识符。"""

    def __init__(self) -> None:
        self.errors: List[str] = []

    def visit_Import(self, node: ast.Import) -> None:  # noqa: N802
        self.errors.append("import statements are forbidden")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:  # noqa: N802
        self.errors.append("from-import statements are forbidden")

    def visit_Name(self, node: ast.Name) -> None:  # noqa: N802
        if node.id in _FORBIDDEN_NAMES:
            self.errors.append(f"name '{node.id}' is forbidden")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:  # noqa: N802
        if node.attr in _FORBIDDEN_ATTRS:
            self.errors.append(f"attribute '{node.attr}' is forbidden")
        self.generic_visit(node)

    def generic_visit(self, node: ast.AST) -> None:  # noqa: N802
        # 检查节点类型是否在白名单
        if type(node) not in _ALLOWED_NODES and not isinstance(node, ast.operator) \
                and not isinstance(node, ast.cmpop) and not isinstance(node, ast.expr_context):
            self.errors.append(f"node type '{type(node).__name__}' is not allowed")
        super().generic_visit(node)


def _validate_code(code: str) -> Tuple[bool, str]:
    """校验代码是否符合 AST 白名单规则。

    Args:
        code: 待校验的 Python 代码字符串

    Returns:
        (is_valid, error_message): is_valid=True 时 error_message 为空字符串
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"Syntax error: {e}"

    validator = CodeValidator()
    validator.visit(tree)

    if validator.errors:
        return False, "; ".join(validator.errors[:3])  # 仅返回前 3 个错误

    return True, ""


class CodeExecutorTool(BaseTool):
    """P3-12.3.4: 代码执行工具。

    通过 AST 白名单校验 + 子进程隔离执行用户提交的 Python 代码，
    防止沙箱逃逸（import / eval / __class__.__bases__ 等）。

    该工具默认 ``requires_approval() = True``，仅在 HITL 关闭或审批通过时执行。
    """

    def __init__(self, timeout_seconds: int = 10) -> None:
        self._timeout = timeout_seconds

    def name(self) -> str:
        return "code_executor"

    def description(self) -> str:
        return (
            "执行 Python 代码（沙箱隔离），支持纯计算、字符串处理、列表/字典操作；"
            "禁止 import、文件 IO、网络访问、子进程调用"
        )

    def parameters_schema(self) -> Dict:
        return {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "待执行的 Python 代码（禁用 import/eval/exec/open）",
                },
            },
            "required": ["code"],
        }

    def requires_approval(self) -> bool:
        """P3-12.3.2: 代码执行需人工审批。"""
        return True

    def on_approval_rejected(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """审批拒绝时的友好降级。"""
        return {
            "status": "error",
            "error_code": "TOOL_APPROVAL_REJECTED",
            "data": {
                "message": "Code execution was rejected by the human reviewer",
                "code_preview": (params.get("code", "")[:80] + "...") if len(params.get("code", "")) > 80 else params.get("code", ""),
            },
        }

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        code = params.get("code", "")

        if not isinstance(code, str) or not code.strip():
            return {
                "status": "error",
                "error_code": "CODE_001",
                "data": {"message": "Code is empty"},
            }

        # 1. AST 白名单校验
        is_valid, error_msg = _validate_code(code)
        if not is_valid:
            logger.warning("CodeExecutor rejected code: %s", error_msg)
            return {
                "status": "error",
                "error_code": "CODE_002",
                "data": {"message": f"Code validation failed: {error_msg}"},
            }

        # 2. 子进程隔离执行
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".py", delete=False, encoding="utf-8"
            ) as f:
                f.write(code)
                temp_path = f.name

            try:
                # -I: 隔离用户站点包；最小环境变量
                env = {"PATH": os.environ.get("PATH", "/usr/bin")}
                result = subprocess.run(
                    [sys.executable, "-I", temp_path],
                    capture_output=True,
                    timeout=self._timeout,
                    env=env,
                    text=True,
                )

                # 截断输出避免内存爆炸
                stdout = result.stdout[:4096] if result.stdout else ""
                stderr = result.stderr[:4096] if result.stderr else ""

                if result.returncode == 0:
                    return {
                        "status": "success",
                        "error_code": "",
                        "data": {
                            "stdout": stdout,
                            "stderr": stderr,
                            "returncode": 0,
                        },
                    }
                else:
                    return {
                        "status": "error",
                        "error_code": "CODE_003",
                        "data": {
                            "stdout": stdout,
                            "stderr": stderr,
                            "returncode": result.returncode,
                            "message": f"Process exited with code {result.returncode}",
                        },
                    }
            finally:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

        except subprocess.TimeoutExpired:
            logger.warning("CodeExecutor timeout after %ds", self._timeout)
            return {
                "status": "error",
                "error_code": "CODE_004",
                "data": {"message": f"Execution timeout after {self._timeout}s"},
            }
        except Exception as e:
            logger.error("CodeExecutor error: %s", str(e))
            return {
                "status": "error",
                "error_code": "CODE_005",
                "data": {"message": f"Execution failed: {e}"},
            }
