"""P3-12.3.4 工具库扩展单元测试。

测试矩阵（对照技术方案 §6.2.4）：
    - CodeExecutorTool: AST 白名单、禁止名称、子进程超时、审批标记
    - FileOpsTool: 路径穿越、符号链接、工作目录内读写
    - SqlQueryTool: 参数化查询、只读约束
    - DateTimeTool: 时间格式化
    - HttpRequestTool: SSRF 防护、协议白名单
    - 集成: 5 个新工具经 build_langchain_tools 成功包装
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

_TOOL_PATH = r"d:\Administrator\Desktop\pioneering\apps\backend\ModuAgent"
if _TOOL_PATH not in sys.path:
    sys.path.insert(0, _TOOL_PATH)


# ============================================================================
# 1. CodeExecutorTool 测试
# ============================================================================

class TestCodeExecutor:
    """代码执行沙箱安全测试。"""

    def test_approval_required(self, code_executor_tool) -> None:
        """requires_approval()=True。"""
        assert code_executor_tool.requires_approval() is True

    def test_ast_whitelist_blocks_import(self, code_executor_tool) -> None:
        """含 import 的代码被拒绝。"""
        result = code_executor_tool.invoke({"code": "import os"}, {})
        assert result["status"] == "error"
        assert result["error_code"] == "CODE_002"
        assert "forbidden" in result["data"]["message"].lower() or "import" in result["data"]["message"].lower()

    def test_ast_whitelist_blocks_eval(self, code_executor_tool) -> None:
        """含 eval 的代码被拒绝。"""
        result = code_executor_tool.invoke({"code": "eval('1+1')"}, {})
        assert result["status"] == "error"
        assert result["error_code"] == "CODE_002"

    def test_ast_whitelist_blocks_exec(self, code_executor_tool) -> None:
        """含 exec 的代码被拒绝。"""
        result = code_executor_tool.invoke({"code": "exec('print(1)')"}, {})
        assert result["status"] == "error"
        assert result["error_code"] == "CODE_002"

    def test_forbidden_name_os(self, code_executor_tool) -> None:
        """__import__('os') 被拒绝。"""
        result = code_executor_tool.invoke(
            {"code": "__import__('os').system('echo hack')"}, {}
        )
        assert result["status"] == "error"
        assert result["error_code"] == "CODE_002"

    def test_forbidden_name_subprocess(self, code_executor_tool) -> None:
        """subprocess 被拒绝。"""
        result = code_executor_tool.invoke(
            {"code": "import subprocess"}, {}
        )
        assert result["status"] == "error"

    def test_forbidden_class_chain(self, code_executor_tool) -> None:
        """__class__.__bases__ 链被拒绝。"""
        result = code_executor_tool.invoke(
            {"code": "[c for c in ().__class__.__bases__[0].__subclasses__()]"}, {}
        )
        assert result["status"] == "error"
        assert result["error_code"] == "CODE_002"

    def test_simple_arithmetic_succeeds(self, code_executor_tool) -> None:
        """简单算术代码执行成功。"""
        result = code_executor_tool.invoke({"code": "print(1 + 2)"}, {})
        assert result["status"] == "success"
        assert "3" in result["data"]["stdout"]
        assert result["data"]["returncode"] == 0

    def test_string_operations_succeed(self, code_executor_tool) -> None:
        """字符串操作执行成功。"""
        code = "x = 'hello'\nprint(x.upper())"
        result = code_executor_tool.invoke({"code": code}, {})
        assert result["status"] == "success"
        assert "HELLO" in result["data"]["stdout"]

    def test_list_comprehension_succeeds(self, code_executor_tool) -> None:
        """列表推导式执行成功。"""
        code = "result = [x*2 for x in range(5)]\nprint(result)"
        result = code_executor_tool.invoke({"code": code}, {})
        assert result["status"] == "success"
        assert "[0, 2, 4, 6, 8]" in result["data"]["stdout"]

    def test_subprocess_timeout(self, code_executor_tool) -> None:
        """死循环代码 10s 超时被 kill。"""
        # 设置较短超时避免测试过慢
        from components.action.tools.code_executor import CodeExecutorTool

        tool = CodeExecutorTool(timeout_seconds=2)
        result = tool.invoke({"code": "while True:\n    pass"}, {})
        assert result["status"] == "error"
        assert result["error_code"] == "CODE_004"
        assert "timeout" in result["data"]["message"].lower()

    def test_empty_code_rejected(self, code_executor_tool) -> None:
        """空代码被拒绝。"""
        result = code_executor_tool.invoke({"code": ""}, {})
        assert result["status"] == "error"
        assert result["error_code"] == "CODE_001"

    def test_on_approval_rejected(self, code_executor_tool) -> None:
        """审批拒绝降级结果。"""
        result = code_executor_tool.on_approval_rejected({"code": "print(1)"})
        assert result["status"] == "error"
        assert result["error_code"] == "TOOL_APPROVAL_REJECTED"


# ============================================================================
# 2. FileOpsTool 测试
# ============================================================================

class TestFileOps:
    """文件操作工具安全测试。"""

    def test_approval_required(self, file_ops_tool) -> None:
        """requires_approval()=True。"""
        assert file_ops_tool.requires_approval() is True

    def test_path_traversal_blocked(self, file_ops_tool) -> None:
        """../etc/passwd 被拒绝。"""
        result = file_ops_tool.invoke(
            {"path": "../../../etc/passwd", "op": "read"}, {}
        )
        assert result["status"] == "error"

    def test_absolute_path_blocked(self, file_ops_tool) -> None:
        """绝对路径被拒绝。"""
        result = file_ops_tool.invoke(
            {"path": "/etc/shadow", "op": "read"}, {}
        )
        assert result["status"] == "error"

    def test_windows_path_blocked(self, file_ops_tool) -> None:
        """Windows 绝对路径被拒绝。"""
        result = file_ops_tool.invoke(
            {"path": "C:\\Windows\\System32\\config\\SAM", "op": "read"}, {}
        )
        assert result["status"] == "error"

    def test_write_and_read_within_workspace(self, file_ops_tool) -> None:
        """工作目录内文件可读写。"""
        # 写入
        write_result = file_ops_tool.invoke(
            {"path": "test.txt", "op": "write", "content": "hello world"}, {}
        )
        assert write_result["status"] == "success"

        # 读取
        read_result = file_ops_tool.invoke(
            {"path": "test.txt", "op": "read"}, {}
        )
        assert read_result["status"] == "success"
        assert "hello world" in read_result["data"]["content"]

    def test_list_within_workspace(self, file_ops_tool) -> None:
        """列出工作目录文件。"""
        # 先写入文件
        file_ops_tool.invoke(
            {"path": "file1.txt", "op": "write", "content": "content1"}, {}
        )
        file_ops_tool.invoke(
            {"path": "file2.txt", "op": "write", "content": "content2"}, {}
        )

        # 列出
        result = file_ops_tool.invoke({"path": ".", "op": "list"}, {})
        assert result["status"] == "success"
        entries = result["data"]["entries"]
        # entries 是 dict 列表（含 name/type/size）
        names = [e["name"] if isinstance(e, dict) else e for e in entries]
        assert "file1.txt" in names
        assert "file2.txt" in names

    def test_delete_file(self, file_ops_tool) -> None:
        """删除工作目录内文件。"""
        file_ops_tool.invoke(
            {"path": "to_delete.txt", "op": "write", "content": "temp"}, {}
        )
        result = file_ops_tool.invoke(
            {"path": "to_delete.txt", "op": "delete"}, {}
        )
        assert result["status"] == "success"

    def test_read_nonexistent_file(self, file_ops_tool) -> None:
        """读取不存在的文件返回错误。"""
        result = file_ops_tool.invoke(
            {"path": "nonexistent.txt", "op": "read"}, {}
        )
        assert result["status"] == "error"

    def test_empty_path_rejected(self, file_ops_tool) -> None:
        """空路径被拒绝。"""
        result = file_ops_tool.invoke({"path": "", "op": "read"}, {})
        assert result["status"] == "error"

    def test_invalid_op_rejected(self, file_ops_tool) -> None:
        """无效操作被拒绝。"""
        result = file_ops_tool.invoke(
            {"path": "test.txt", "op": "invalid_op"}, {}
        )
        assert result["status"] == "error"

    def test_on_approval_rejected(self, file_ops_tool) -> None:
        """审批拒绝降级结果。"""
        result = file_ops_tool.on_approval_rejected({"path": "test.txt", "op": "read"})
        assert result["status"] == "error"
        assert result["error_code"] == "TOOL_APPROVAL_REJECTED"


# ============================================================================
# 3. SqlQueryTool 测试
# ============================================================================

class TestSqlQuery:
    """SQL 查询工具安全测试。"""

    def test_approval_required(self, sql_query_tool) -> None:
        """requires_approval()=True。"""
        assert sql_query_tool.requires_approval() is True

    def test_select_query_succeeds(self, sql_query_tool) -> None:
        """SELECT 查询执行成功。"""
        # 先创建测试表
        import sqlite3

        conn = sqlite3.connect(sql_query_tool._db_path)
        conn.execute("CREATE TABLE IF NOT EXISTS test (id INTEGER, name TEXT)")
        conn.execute("INSERT INTO test VALUES (1, 'alice')")
        conn.execute("INSERT INTO test VALUES (2, 'bob')")
        conn.commit()
        conn.close()

        result = sql_query_tool.invoke(
            {"query": "SELECT * FROM test WHERE id = ?", "params": [1]}, {}
        )
        assert result["status"] == "success"
        assert len(result["data"]["rows"]) == 1
        assert result["data"]["rows"][0][1] == "alice"

    def test_drop_blocked(self, sql_query_tool) -> None:
        """DROP 语句被拒绝。"""
        result = sql_query_tool.invoke(
            {"query": "DROP TABLE users"}, {}
        )
        assert result["status"] == "error"

    def test_delete_blocked(self, sql_query_tool) -> None:
        """DELETE 语句被拒绝。"""
        result = sql_query_tool.invoke(
            {"query": "DELETE FROM test WHERE 1=1"}, {}
        )
        assert result["status"] == "error"

    def test_insert_blocked(self, sql_query_tool) -> None:
        """INSERT 语句被拒绝。"""
        result = sql_query_tool.invoke(
            {"query": "INSERT INTO test VALUES (3, 'eve')"}, {}
        )
        assert result["status"] == "error"

    def test_multiple_statements_blocked(self, sql_query_tool) -> None:
        """多语句（分号）被拒绝。"""
        result = sql_query_tool.invoke(
            {"query": "SELECT * FROM test; DROP TABLE test"}, {}
        )
        assert result["status"] == "error"

    def test_parameterized_query(self, sql_query_tool) -> None:
        """参数化查询正常工作。"""
        import sqlite3

        conn = sqlite3.connect(sql_query_tool._db_path)
        conn.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)")
        conn.execute("INSERT INTO users VALUES (1, 'alice')")
        conn.execute("INSERT INTO users VALUES (2, 'bob')")
        conn.commit()
        conn.close()

        # 参数化查询
        result = sql_query_tool.invoke(
            {"query": "SELECT * FROM users WHERE name = ?", "params": ["alice"]},
            {},
        )
        assert result["status"] == "success"
        assert len(result["data"]["rows"]) == 1

    def test_empty_query_rejected(self, sql_query_tool) -> None:
        """空查询被拒绝。"""
        result = sql_query_tool.invoke({"query": ""}, {})
        assert result["status"] == "error"

    def test_on_approval_rejected(self, sql_query_tool) -> None:
        """审批拒绝降级结果。"""
        result = sql_query_tool.on_approval_rejected({"query": "SELECT 1"})
        assert result["status"] == "error"
        assert result["error_code"] == "TOOL_APPROVAL_REJECTED"


# ============================================================================
# 4. DateTimeTool 测试
# ============================================================================

class TestDateTimeTool:
    """时间日期工具测试。"""

    def test_no_approval_required(self, datetime_tool) -> None:
        """DateTimeTool 不需要审批（纯计算）。"""
        assert datetime_tool.requires_approval() is False

    def test_now_operation(self, datetime_tool) -> None:
        """now 操作返回当前时间。"""
        result = datetime_tool.invoke({"op": "now"}, {})
        assert result["status"] == "success"
        assert "timestamp" in result["data"] or "iso" in result["data"]

    def test_format_operation(self, datetime_tool) -> None:
        """format 操作格式化日期字符串。"""
        result = datetime_tool.invoke(
            {"op": "format", "datetime_str": "2024-01-15T10:30:00", "format_str": "%Y-%m-%d"}, {}
        )
        assert result["status"] == "success"
        assert "2024-01-15" in result["data"].get("formatted", "")

    def test_parse_operation(self, datetime_tool) -> None:
        """parse 操作解析时间字符串。"""
        result = datetime_tool.invoke(
            {"op": "parse", "datetime_str": "2024-01-15 10:30:00", "format": "%Y-%m-%d %H:%M:%S"}, {}
        )
        assert result["status"] == "success"

    def test_invalid_op_rejected(self, datetime_tool) -> None:
        """无效操作被拒绝。"""
        result = datetime_tool.invoke({"op": "invalid"}, {})
        assert result["status"] == "error"


# ============================================================================
# 5. HttpRequestTool 测试
# ============================================================================

class TestHttpRequest:
    """HTTP 请求工具安全测试。"""

    def test_approval_required(self, http_request_tool) -> None:
        """requires_approval()=True。"""
        assert http_request_tool.requires_approval() is True

    def test_ssrf_localhost_blocked(self, http_request_tool) -> None:
        """127.0.0.1 被拒绝。"""
        result = http_request_tool.invoke(
            {"url": "http://127.0.0.1:8080/admin"}, {}
        )
        assert result["status"] == "error"
        assert "ssrf" in result["error_code"].lower() or "private" in result["data"].get("message", "").lower() or "internal" in result["data"].get("message", "").lower()

    def test_ssrf_private_network_blocked(self, http_request_tool) -> None:
        """10.0.0.0/8 内网被拒绝。"""
        result = http_request_tool.invoke(
            {"url": "http://10.0.0.1/internal"}, {}
        )
        assert result["status"] == "error"

    def test_ssrf_192168_blocked(self, http_request_tool) -> None:
        """192.168.0.0/16 内网被拒绝。"""
        result = http_request_tool.invoke(
            {"url": "http://192.168.1.1/router"}, {}
        )
        assert result["status"] == "error"

    def test_ssrf_loopback_ipv6_blocked(self, http_request_tool) -> None:
        """::1 IPv6 回环被拒绝。"""
        result = http_request_tool.invoke(
            {"url": "http://[::1]:8080/"}, {}
        )
        assert result["status"] == "error"

    def test_ssrf_link_local_blocked(self, http_request_tool) -> None:
        """169.254.0.0/16 链路本地被拒绝。"""
        result = http_request_tool.invoke(
            {"url": "http://169.254.169.254/latest/meta-data/"}, {}
        )
        assert result["status"] == "error"

    def test_invalid_protocol_blocked(self, http_request_tool) -> None:
        """非 http/https 协议被拒绝。"""
        result = http_request_tool.invoke(
            {"url": "ftp://example.com/file"}, {}
        )
        assert result["status"] == "error"

    def test_empty_url_rejected(self, http_request_tool) -> None:
        """空 URL 被拒绝。"""
        result = http_request_tool.invoke({"url": ""}, {})
        assert result["status"] == "error"

    def test_on_approval_rejected(self, http_request_tool) -> None:
        """审批拒绝降级结果。"""
        result = http_request_tool.on_approval_rejected({"url": "http://example.com"})
        assert result["status"] == "error"
        assert result["error_code"] == "TOOL_APPROVAL_REJECTED"


# ============================================================================
# 6. 工具适配集成测试
# ============================================================================

class TestToolAdapter:
    """新工具经 LangChain 适配器包装测试。"""

    def test_all_new_tools_wrap_to_langchain(
        self,
        code_executor_tool,
        file_ops_tool,
        sql_query_tool,
        datetime_tool,
        http_request_tool,
        fresh_config,
        fresh_registry,
    ) -> None:
        """5 个新工具经 build_langchain_tools 成功包装为 LangChain StructuredTool。"""
        # 由于本地 langgraph 包名遮蔽库，tool_adapter 导入可能失败
        try:
            from langgraph.adapters.tool_adapter import wrap_modu_tool
        except ImportError:
            pytest.skip("langgraph tool_adapter not importable (package name shadowing)")

        tools = [
            code_executor_tool,
            file_ops_tool,
            sql_query_tool,
            datetime_tool,
            http_request_tool,
        ]

        for tool in tools:
            lc_tool = wrap_modu_tool(tool, fresh_config)
            # 验证是 LangChain BaseTool
            from langchain_core.tools import BaseTool as LCTool

            assert isinstance(lc_tool, LCTool), f"{tool.name()} should wrap to LangChain BaseTool"
            # 验证名称和描述
            assert lc_tool.name == tool.name()
            assert lc_tool.description == tool.description()

    def test_all_new_tools_implement_basetool_interface(
        self,
        code_executor_tool,
        file_ops_tool,
        sql_query_tool,
        datetime_tool,
        http_request_tool,
    ) -> None:
        """所有新工具实现 BaseTool 接口（name/description/parameters_schema/invoke）。"""
        tools = [
            code_executor_tool,
            file_ops_tool,
            sql_query_tool,
            datetime_tool,
            http_request_tool,
        ]

        for tool in tools:
            assert isinstance(tool.name(), str), f"{tool.__class__.__name__}.name() must return str"
            assert isinstance(tool.description(), str), f"{tool.__class__.__name__}.description() must return str"
            assert isinstance(tool.parameters_schema(), dict), f"{tool.__class__.__name__}.parameters_schema() must return dict"
            # requires_approval 必须返回 bool
            assert isinstance(tool.requires_approval(), bool), f"{tool.__class__.__name__}.requires_approval() must return bool"

    def test_tool_names_are_unique(
        self,
        code_executor_tool,
        file_ops_tool,
        sql_query_tool,
        datetime_tool,
        http_request_tool,
    ) -> None:
        """所有新工具的 name() 唯一。"""
        names = [
            code_executor_tool.name(),
            file_ops_tool.name(),
            sql_query_tool.name(),
            datetime_tool.name(),
            http_request_tool.name(),
        ]
        assert len(names) == len(set(names)), "Tool names must be unique"
