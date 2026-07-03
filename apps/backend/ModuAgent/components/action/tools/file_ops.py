"""P3-12.3.4: 文件操作工具（路径校验 + 工作目录约束）。

安全策略：
    1. 工作目录约束：所有路径必须位于 allowed_root 下
    2. 路径穿越检测：拒绝 ``..`` 与绝对路径
    3. 符号链接检测：拒绝指向 allowed_root 外的 symlink
    4. 写操作需人工审批（requires_approval=True）

allowed_root 通过环境变量 ``MODU_FILE_OPS_ROOT`` 或参数指定，默认为系统临时目录。
"""
from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)


class FileOpsTool(BaseTool):
    """P3-12.3.4: 文件操作工具。

    支持 read / write / list / delete 四种操作，所有路径必须位于 allowed_root 下。

    写操作（write / delete）需要人工审批（仅在 HITL 开启时生效）。
    """

    def __init__(self, allowed_root: Optional[str] = None) -> None:
        if allowed_root:
            self._allowed_root: Path = Path(allowed_root).resolve()
        else:
            # 默认使用环境变量或系统临时目录
            env_root = os.environ.get("MODU_FILE_OPS_ROOT")
            if env_root:
                self._allowed_root = Path(env_root).resolve()
            else:
                self._allowed_root = Path(tempfile.gettempdir()).resolve() / "modu_workspace"
        # 确保目录存在
        self._allowed_root.mkdir(parents=True, exist_ok=True)

    def name(self) -> str:
        return "file_ops"

    def description(self) -> str:
        return (
            "在工作目录内读写文件，支持 read/write/list/delete 操作；"
            "禁止路径穿越（..）与符号链接到工作目录外"
        )

    def parameters_schema(self) -> Dict:
        return {
            "type": "object",
            "properties": {
                "op": {
                    "type": "string",
                    "description": "操作类型：read/write/list/delete",
                    "enum": ["read", "write", "list", "delete"],
                },
                "path": {
                    "type": "string",
                    "description": "相对工作目录的文件路径（禁用 .. 与绝对路径）",
                },
                "content": {
                    "type": "string",
                    "description": "write 操作时的文件内容",
                },
            },
            "required": ["op", "path"],
        }

    def requires_approval(self) -> bool:
        """file_ops 整体需要审批；细分场景由 invoke 内部根据 op 决定。"""
        return True

    def on_approval_rejected(self, params: Dict[str, Any]) -> Dict[str, Any]:
        op = params.get("op", "")
        path = params.get("path", "")
        return {
            "status": "error",
            "error_code": "TOOL_APPROVAL_REJECTED",
            "data": {
                "message": f"File operation '{op}' on '{path}' was rejected by reviewer",
            },
        }

    def _validate_path(self, rel_path: str) -> Path:
        """校验路径是否在 allowed_root 内，返回绝对路径。

        Args:
            rel_path: 相对工作目录的路径

        Returns:
            校验通过的绝对路径

        Raises:
            ValueError: 路径穿越或符号链接指向外部
        """
        if not rel_path:
            raise ValueError("Path is empty")

        # 拒绝绝对路径与盘符前缀（Windows）
        if os.path.isabs(rel_path) or rel_path[0:2] in ("C:", "D:", "E:", "F:"):
            raise ValueError(f"Absolute path not allowed: {rel_path}")

        # 拒绝 .. 路径穿越
        if ".." in Path(rel_path).parts:
            raise ValueError(f"Path traversal not allowed: {rel_path}")

        # 解析为绝对路径并校验在 allowed_root 内
        full_path = (self._allowed_root / rel_path).resolve()
        try:
            full_path.relative_to(self._allowed_root)
        except ValueError as e:
            raise ValueError(f"Path escapes workspace: {rel_path}") from e

        # 检查符号链接（如果文件已存在且为 symlink）
        if full_path.is_symlink():
            real_target = full_path.resolve()
            try:
                real_target.relative_to(self._allowed_root)
            except ValueError as e:
                raise ValueError(
                    f"Symlink points outside workspace: {rel_path} -> {real_target}"
                ) from e

        return full_path

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        op = params.get("op", "")
        rel_path = params.get("path", "")
        content = params.get("content", "")

        if op not in ("read", "write", "list", "delete"):
            return {
                "status": "error",
                "error_code": "FILE_001",
                "data": {"message": f"Invalid op: {op}"},
            }

        try:
            full_path = self._validate_path(rel_path)
        except ValueError as e:
            return {
                "status": "error",
                "error_code": "FILE_002",
                "data": {"message": str(e)},
            }

        try:
            if op == "read":
                if not full_path.exists():
                    return {
                        "status": "error",
                        "error_code": "FILE_003",
                        "data": {"message": f"File not found: {rel_path}"},
                    }
                if not full_path.is_file():
                    return {
                        "status": "error",
                        "error_code": "FILE_004",
                        "data": {"message": f"Not a file: {rel_path}"},
                    }
                # 限制读取大小 256KB
                text = full_path.read_text(encoding="utf-8", errors="replace")[:262144]
                return {
                    "status": "success",
                    "error_code": "",
                    "data": {
                        "content": text,
                        "path": rel_path,
                        "size": full_path.stat().st_size,
                    },
                }

            elif op == "write":
                if not isinstance(content, str):
                    return {
                        "status": "error",
                        "error_code": "FILE_005",
                        "data": {"message": "content must be a string"},
                    }
                full_path.parent.mkdir(parents=True, exist_ok=True)
                full_path.write_text(content, encoding="utf-8")
                return {
                    "status": "success",
                    "error_code": "",
                    "data": {
                        "path": rel_path,
                        "bytes_written": len(content.encode("utf-8")),
                    },
                }

            elif op == "list":
                if not full_path.exists():
                    return {
                        "status": "error",
                        "error_code": "FILE_003",
                        "data": {"message": f"Path not found: {rel_path}"},
                    }
                if not full_path.is_dir():
                    return {
                        "status": "error",
                        "error_code": "FILE_006",
                        "data": {"message": f"Not a directory: {rel_path}"},
                    }
                entries = []
                for entry in sorted(full_path.iterdir()):
                    entries.append({
                        "name": entry.name,
                        "type": "dir" if entry.is_dir() else "file",
                        "size": entry.stat().st_size if entry.is_file() else 0,
                    })
                return {
                    "status": "success",
                    "error_code": "",
                    "data": {"path": rel_path, "entries": entries},
                }

            elif op == "delete":
                if not full_path.exists():
                    return {
                        "status": "error",
                        "error_code": "FILE_003",
                        "data": {"message": f"File not found: {rel_path}"},
                    }
                # 仅允许删除文件，不允许删除目录
                if full_path.is_dir():
                    return {
                        "status": "error",
                        "error_code": "FILE_007",
                        "data": {"message": f"Cannot delete directory: {rel_path}"},
                    }
                full_path.unlink()
                return {
                    "status": "success",
                    "error_code": "",
                    "data": {"path": rel_path, "deleted": True},
                }

        except OSError as e:
            logger.error("FileOps error: %s", str(e))
            return {
                "status": "error",
                "error_code": "FILE_008",
                "data": {"message": f"OS error: {e}"},
            }
        except Exception as e:
            logger.error("FileOps unexpected error: %s", str(e))
            return {
                "status": "error",
                "error_code": "FILE_009",
                "data": {"message": f"Unexpected error: {e}"},
            }

    @property
    def allowed_root(self) -> Path:
        """工作目录根路径。"""
        return self._allowed_root
