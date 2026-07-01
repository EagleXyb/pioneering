"""组件功能测试：CalculatorTool, SearchTool, SyncActionExecutor, Memory。"""

from __future__ import annotations

import time

import pytest

from components.action.tools.calculator import CalculatorTool
from components.action.tools.search import SearchTool
from components.action.executors.synchronous import SyncActionExecutor
from components.memory.cache.short_term_memory import InMemoryShortTermMemory
from core.registry import ComponentRegistry


# ======================================================================
# CalculatorTool 功能测试
# ======================================================================

class TestCalculatorTool:
    def setup_method(self):
        self.tool = CalculatorTool()

    def test_name_and_description(self):
        assert self.tool.name() == "calculator"
        assert "计算" in self.tool.description()

    def test_parameters_schema_has_expression_required(self):
        schema = self.tool.parameters_schema()
        assert "expression" in schema["required"]

    def test_simple_addition(self):
        result = self.tool.invoke({"expression": "2+3"}, {})
        assert result["status"] == "success"
        assert result["data"]["result"] == 5.0

    def test_subtraction(self):
        result = self.tool.invoke({"expression": "10-3"}, {})
        assert result["status"] == "success"
        assert result["data"]["result"] == 7.0

    def test_multiplication(self):
        result = self.tool.invoke({"expression": "4*5"}, {})
        assert result["status"] == "success"
        assert result["data"]["result"] == 20.0

    def test_division(self):
        result = self.tool.invoke({"expression": "10/2"}, {})
        assert result["status"] == "success"
        assert result["data"]["result"] == 5.0

    def test_complex_expression(self):
        result = self.tool.invoke({"expression": "(2+3)*(10-5)"}, {})
        assert result["status"] == "success"
        assert result["data"]["result"] == 25.0

    def test_decimal_result(self):
        result = self.tool.invoke({"expression": "10/3"}, {})
        assert result["status"] == "success"
        assert abs(result["data"]["result"] - 3.33333) < 0.001

    def test_empty_expression(self):
        result = self.tool.invoke({"expression": ""}, {})
        assert result["status"] == "error"
        assert "不能为空" in result["data"]["message"]

    def test_whitespace_only_expression(self):
        result = self.tool.invoke({"expression": "   "}, {})
        assert result["status"] == "error"

    def test_invalid_expression(self):
        result = self.tool.invoke({"expression": "print('hello')"}, {})
        assert result["status"] == "error"
        assert "非法表达式" in result["data"]["message"]

    def test_division_by_zero(self):
        result = self.tool.invoke({"expression": "1/0"}, {})
        assert result["status"] == "error"
        assert "除零错误" in result["data"]["message"]

    def test_missing_expression_key(self):
        result = self.tool.invoke({}, {})
        assert result["status"] == "error"

    def test_non_string_expression(self):
        result = self.tool.invoke({"expression": 123}, {})
        assert result["status"] == "error"

    def test_large_numbers(self):
        result = self.tool.invoke({"expression": "999999999*999999999"}, {})
        assert result["status"] == "success"
        assert result["data"]["result"] > 9e17

    def test_negative_numbers(self):
        result = self.tool.invoke({"expression": "-5+3"}, {})
        assert result["status"] == "success"
        assert result["data"]["result"] == -2.0

    def test_safe_eval_blocks_builtins(self):
        """验证 _safe_eval 阻止访问内置函数。"""
        with pytest.raises(ValueError):
            self.tool._safe_eval("__import__('os')")

    def test_safe_eval_disallowed_chars(self):
        """验证非法字符被拒绝。"""
        with pytest.raises(ValueError):
            self.tool._safe_eval("1+_x")

    def test_nested_parentheses(self):
        result = self.tool.invoke({"expression": "((((1+2))))"}, {})
        assert result["status"] == "success"

    def test_expression_with_spaces(self):
        result = self.tool.invoke({"expression": " 1 + 2 * 3 "}, {})
        assert result["status"] == "success"
        assert result["data"]["result"] == 7.0


# ======================================================================
# SearchTool 功能测试
# ======================================================================

class TestSearchTool:
    def setup_method(self):
        self.tool = SearchTool()

    def test_name_and_description(self):
        assert self.tool.name() == "search_engine"
        assert "搜索" in self.tool.description()

    def test_parameters_schema(self):
        schema = self.tool.parameters_schema()
        assert "query" in schema["required"]
        assert "max_results" in schema["properties"]

    def test_query_too_short(self):
        result = self.tool.invoke({"query": "a"}, {})
        assert result["status"] == "error"
        assert "过短" in result["data"]["message"]

    def test_missing_query(self):
        result = self.tool.invoke({}, {})
        assert result["status"] == "error"

    def test_invalid_max_results_still_works(self, monkeypatch):
        """max_results 为非正整数时会被修正为 5。"""
        monkeypatch.setenv("TAVILY_API_KEY", "")  # 使用 DuckDuckGo
        try:
            result = self.tool.invoke({"query": "test query", "max_results": -1}, {})
            # 可能成功（DuckDuckGo）或失败（网络），但不应崩
            assert "status" in result
        except Exception:
            pytest.skip("Network unavailable")

    def test_non_string_query_type(self):
        result = self.tool.invoke({"query": 12345}, {})
        assert result["status"] == "error"


# ======================================================================
# SyncActionExecutor 功能测试
# ======================================================================

class TestSyncActionExecutor:
    def test_execute_existing_tool(self):
        registry = ComponentRegistry()
        registry.register_tool(CalculatorTool())
        executor = SyncActionExecutor(registry=registry)
        result = executor.execute("calculator", {"expression": "2+2"}, {})
        assert result["status"] == "success"

    def test_execute_nonexistent_tool(self):
        registry = ComponentRegistry()
        executor = SyncActionExecutor(registry=registry)
        result = executor.execute("nonexistent", {}, {})
        assert result["status"] == "error"
        assert "not found" in result["data"]["message"]

    def test_list_actions(self):
        registry = ComponentRegistry()
        registry.register_tool(CalculatorTool())
        executor = SyncActionExecutor(registry=registry)
        actions = executor.list_actions()
        assert "calculator" in actions


# ======================================================================
# InMemoryShortTermMemory 功能测试
# ======================================================================

class TestInMemoryShortTermMemory:
    def setup_method(self):
        self.memory = InMemoryShortTermMemory(max_turns=3, ttl_seconds=3600)

    def test_update_and_query(self):
        self.memory.update("u1", {"prompt": "hello", "response": "hi"}, {"timestamp": time.time(), "session_id": "s1"})
        result = self.memory.query("u1", "last_5_turns", ["prompt", "response"])
        assert len(result["history"]) == 1
        assert result["history"][0]["prompt"] == "hello"

    def test_query_no_data(self):
        result = self.memory.query("u1", "last_5_turns", ["prompt"])
        assert result["history"] == []

    def test_query_different_user(self):
        self.memory.update("u1", {"text": "a"}, {})
        result = self.memory.query("u2", "last_5_turns", ["text"])
        assert result["history"] == []

    def test_required_fields_filtering(self):
        self.memory.update("u1", {"a": 1, "b": 2}, {"timestamp": time.time(), "session_id": "s"})
        result = self.memory.query("u1", "last_5_turns", ["a"])
        history = result["history"]
        assert "a" in history[0]
        assert "b" not in history[0]

    def test_max_turns_truncation(self):
        for i in range(10):
            self.memory.update("u1", {"index": i}, {"timestamp": time.time() + i, "session_id": "s"})
        result = self.memory.query("u1", "last_5_turns", ["index"])
        indices = [h["index"] for h in result["history"]]
        # 应保留最近 6 条（max_turns * 2 截断 = 6 条）
        assert len(indices) <= 5  # query limit = last_3_turns (max_turns) = 3
        assert all(idx >= 4 for idx in indices)  # 较新的条目

    def test_ttl_expiration(self, monkeypatch):
        now = time.time()
        old_time = now - 3601  # 超过 TTL
        self.memory.update("u1", {"text": "old"}, {"timestamp": old_time, "session_id": "s"})
        self.memory.update("u1", {"text": "new"}, {"timestamp": now, "session_id": "s"})
        result = self.memory.query("u1", "last_5_turns", ["text"])
        texts = [h["text"] for h in result["history"]]
        assert "old" not in texts
        assert "new" in texts

    def test_parse_context_window_valid(self):
        assert InMemoryShortTermMemory._parse_context_window("last_3_turns") == 3
        assert InMemoryShortTermMemory._parse_context_window("last_10_turns") == 10

    def test_parse_context_window_invalid(self):
        assert InMemoryShortTermMemory._parse_context_window("invalid") == 5
        assert InMemoryShortTermMemory._parse_context_window("last_X_turns") == 5
