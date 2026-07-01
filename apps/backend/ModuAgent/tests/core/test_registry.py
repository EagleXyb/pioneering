"""ComponentRegistry 单元测试（P2-4）。

覆盖：
    - register/get 各类组件
    - 类型校验（非 BaseTool 子类拒绝注册）
    - swap_component 动态替换
    - list_all / list_tools
    - P2-1: override 参数与 context manager
"""
import pytest

from core.interfaces.action import BaseTool
from core.registry import (
    ComponentRegistry,
    get_registry,
    reset_registry,
    override_registry,
)


class _FakeTool(BaseTool):
    """测试用最小 BaseTool 实现。"""

    def name(self) -> str:
        return "fake_tool"

    def description(self) -> str:
        return "A fake tool for testing"

    def parameters_schema(self) -> dict:
        return {"type": "object", "properties": {}}

    def invoke(self, params: dict, context: dict) -> dict:
        return {"result": "ok"}


class _AnotherTool(BaseTool):
    def name(self) -> str:
        return "another_tool"

    def description(self) -> str:
        return "Another tool"

    def parameters_schema(self) -> dict:
        return {}

    def invoke(self, params: dict, context: dict) -> dict:
        return {}


class TestRegisterAndGet:
    def test_register_and_get_tool(self):
        reg = ComponentRegistry()
        tool = _FakeTool()
        reg.register_tool(tool)
        assert reg.get_tool("fake_tool") is tool

    def test_get_missing_tool_returns_none(self):
        reg = ComponentRegistry()
        assert reg.get_tool("nonexistent") is None

    def test_register_rejects_non_basetool(self):
        reg = ComponentRegistry()
        with pytest.raises(TypeError):
            reg.register_tool("not a tool")

    def test_register_multiple_tools(self):
        reg = ComponentRegistry()
        reg.register_tool(_FakeTool())
        reg.register_tool(_AnotherTool())
        assert reg.get_tool("fake_tool") is not None
        assert reg.get_tool("another_tool") is not None

    def test_list_tools(self):
        reg = ComponentRegistry()
        reg.register_tool(_FakeTool())
        tools = reg.list_tools()
        assert "fake_tool" in tools
        assert tools["fake_tool"]["name"] == "fake_tool"
        assert tools["fake_tool"]["description"] == "A fake tool for testing"


class TestSwapComponent:
    def test_swap_tool(self):
        reg = ComponentRegistry()
        original = _FakeTool()
        replacement = _AnotherTool()
        reg.register_tool(original)

        ok = reg.swap_component("tool", "fake_tool", replacement)
        assert ok is True
        assert reg.get_tool("fake_tool") is replacement

    def test_swap_unknown_category(self):
        reg = ComponentRegistry()
        ok = reg.swap_component("unknown_category", "name", object())
        assert ok is False


class TestListAll:
    def test_list_all_empty(self):
        reg = ComponentRegistry()
        result = reg.list_all()
        assert all(len(v) == 0 for v in result.values())

    def test_list_all_with_components(self):
        reg = ComponentRegistry()
        reg.register_tool(_FakeTool())
        result = reg.list_all()
        assert "fake_tool" in result["tools"]


class TestOverrideAndReset:
    def test_get_registry_returns_singleton(self):
        reset_registry()
        r1 = get_registry()
        r2 = get_registry()
        assert r1 is r2

    def test_override_replaces_singleton(self):
        reset_registry()
        original = get_registry()
        custom = ComponentRegistry()
        result = get_registry(override=custom)
        assert result is custom
        assert get_registry() is custom

    def test_reset_registry_clears_singleton(self):
        reset_registry()
        r1 = get_registry()
        reset_registry()
        r2 = get_registry()
        assert r1 is not r2

    def test_override_registry_context_manager(self):
        reset_registry()
        original = get_registry()
        custom = ComponentRegistry()
        with override_registry(custom) as ctx:
            assert ctx is custom
            assert get_registry() is custom
        assert get_registry() is original

    def test_override_registry_restores_on_exception(self):
        reset_registry()
        original = get_registry()
        custom = ComponentRegistry()
        with pytest.raises(RuntimeError):
            with override_registry(custom):
                raise RuntimeError("test")
        assert get_registry() is original
