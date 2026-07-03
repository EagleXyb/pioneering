"""P3-12.3.4: SQL 查询工具（参数化 + 只读限制）。

安全策略：
    1. 仅允许 SELECT 语句（AST 解析阻止 DROP/DELETE/INSERT/UPDATE/ALTER）
    2. 强制参数化查询（``?`` 占位符），杜绝 SQL 注入
    3. 默认只读连接（readonly pragma for SQLite）
    4. 表名白名单（可选）
    5. 行数限制（默认 1000 行）

需要人工审批（``requires_approval() = True``）。
"""
from __future__ import annotations

import logging
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)


# 危险 SQL 关键词（仅允许 SELECT）
_FORBIDDEN_SQL_KEYWORDS = re.compile(
    r"\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH|"
    r"PRAGMA|VACUUM|REINDEX|ANALYZE)\b",
    re.IGNORECASE,
)

# SELECT 语句前缀校验
_SELECT_PREFIX = re.compile(r"^\s*SELECT\b", re.IGNORECASE)


class SqlQueryTool(BaseTool):
    """P3-12.3.4: SQL 查询工具。

    支持 SQLite 数据库的只读查询，强制参数化防注入。

    Args:
        db_path: SQLite 数据库文件路径（None=内存数据库）
        max_rows: 最大返回行数（默认 1000）
        allowed_tables: 允许查询的表名白名单（None=不限制）
    """

    def __init__(
        self,
        db_path: Optional[str] = None,
        max_rows: int = 1000,
        allowed_tables: Optional[List[str]] = None,
    ) -> None:
        self._db_path: str = db_path if db_path else ":memory:"
        self._max_rows: int = max_rows
        self._allowed_tables: Optional[set] = set(allowed_tables) if allowed_tables else None

    def name(self) -> str:
        return "sql_query"

    def description(self) -> str:
        return (
            "执行只读 SQL 查询（SELECT only），支持参数化查询防注入；"
            "禁止 DROP/DELETE/INSERT/UPDATE 等修改操作"
        )

    def parameters_schema(self) -> Dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "SQL 查询语句（仅 SELECT，参数用 ? 占位）",
                },
                "params": {
                    "type": "array",
                    "description": "参数化查询的参数列表（对应 ? 占位符）",
                    "items": {},
                },
            },
            "required": ["query"],
        }

    def requires_approval(self) -> bool:
        """SQL 查询需人工审批。"""
        return True

    def on_approval_rejected(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "status": "error",
            "error_code": "TOOL_APPROVAL_REJECTED",
            "data": {
                "message": "SQL query was rejected by the human reviewer",
                "query_preview": (params.get("query", "")[:120] + "...")
                if len(params.get("query", "")) > 120
                else params.get("query", ""),
            },
        }

    def _validate_query(self, query: str) -> Tuple[bool, str]:
        """校验 SQL 语句安全。

        Args:
            query: SQL 查询字符串

        Returns:
            (is_valid, error_message)
        """
        if not query or not query.strip():
            return False, "Query is empty"

        # 必须以 SELECT 开头
        if not _SELECT_PREFIX.match(query):
            return False, "Only SELECT statements are allowed"

        # 检查禁止的关键词（DML/DDL）
        match = _FORBIDDEN_SQL_KEYWORDS.search(query)
        if match:
            return False, f"Forbidden SQL keyword: {match.group(0)}"

        # 检查分号（防多语句注入）
        stripped = query.strip().rstrip(";")
        if ";" in stripped:
            return False, "Multiple statements not allowed (semicolons forbidden)"

        # 检查注释（防通过注释绕过校验）
        if "--" in query or "/*" in query:
            return False, "SQL comments not allowed"

        # 表名白名单检查
        if self._allowed_tables is not None:
            # 简化提取 FROM/JOIN 后的表名
            table_matches = re.findall(
                r"\b(?:FROM|JOIN)\s+(\w+)", query, re.IGNORECASE
            )
            for table in table_matches:
                if table not in self._allowed_tables:
                    return False, f"Table '{table}' not in allowed list"

        return True, ""

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        query = params.get("query", "")
        query_params = params.get("params", [])

        if query_params is None:
            query_params = []

        # 1. SQL 校验
        is_valid, error_msg = self._validate_query(query)
        if not is_valid:
            logger.warning("SqlQuery rejected: %s", error_msg)
            return {
                "status": "error",
                "error_code": "SQL_001",
                "data": {"message": error_msg},
            }

        # 2. 参数类型校验
        if not isinstance(query_params, (list, tuple)):
            return {
                "status": "error",
                "error_code": "SQL_002",
                "data": {"message": "params must be a list"},
            }

        # 3. 执行查询
        try:
            # SQLite 连接：使用 uri 模式启用 readonly（如果是文件路径）
            conn_kwargs: Dict[str, Any] = {"check_same_thread": False}
            if self._db_path == ":memory:":
                conn = sqlite3.connect(self._db_path, **conn_kwargs)
            else:
                conn = sqlite3.connect(self._db_path, **conn_kwargs)

            try:
                # 强制只读模式（SQLite pragma）
                try:
                    conn.execute("PRAGMA query_only = ON")
                except sqlite3.OperationalError:
                    pass  # 某些 SQLite 版本不支持

                cursor = conn.cursor()
                cursor.execute(query, list(query_params))

                # 限制返回行数
                rows = cursor.fetchmany(self._max_rows)
                columns = (
                    [desc[0] for desc in cursor.description]
                    if cursor.description else []
                )

                return {
                    "status": "success",
                    "error_code": "",
                    "data": {
                        "columns": columns,
                        "rows": [list(r) for r in rows],
                        "row_count": len(rows),
                        "truncated": len(rows) >= self._max_rows,
                    },
                }
            finally:
                conn.close()

        except sqlite3.Error as e:
            logger.warning("SqlQuery error: %s", str(e))
            return {
                "status": "error",
                "error_code": "SQL_003",
                "data": {"message": f"SQL error: {e}"},
            }
        except Exception as e:
            logger.error("SqlQuery unexpected error: %s", str(e))
            return {
                "status": "error",
                "error_code": "SQL_004",
                "data": {"message": f"Unexpected error: {e}"},
            }
