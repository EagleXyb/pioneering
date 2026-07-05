"""tool_adapter 单元测试（P2-4）。

覆盖：
    - wrap_modu_tool 将 ModuAgent BaseTool 包装为 LangChain StructuredTool
    - schema 转换（JSON Schema → Pydantic）
    - P2-8: with_tool_retry 包装（需 config）
    - build_langchain_tools 批量构建

依赖 langchain_core（StructuredTool），未安装时自动跳过。
"""
import pytest

pytest.importorskip("langchain_core")

from unittest.mock import MagicMock

# 本地 langgraph/ 包与库同名，在库已安装时触发循环导入（pre-existing 架构限制）。
try:
    from modu_graph.adapters.tool_adapter import wrap_modu_tool, build_langchain_tools, _schema_to_pydantic_model
except ImportError as _e:  # noqa: F401
    pytest.skip(
        f"local langgraph integration not importable (package name shadowing): {_e}",
        allow_module_level=True,
    )
from config.runtime_config import RuntimeConfig
from core.interfaces.action import BaseTool


class _FakeModuTool(BaseTool):
    """测试用 ModuAgent BaseTool 实现。"""

    def name(self) -> str:
        return "fake_tool"

    def description(self) -> str:
        return "A fake tool for testing"

    def parameters_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Max results"},
            },
            "required": ["query"],
        }

    def invoke(self, params: dict, context: dict) -> dict:
        return {"result": f"searched: {params.get('query', '')}"}


class TestSchemaToPydantic:
    def test_basic_schema_conversion(self):
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name"},
                "age": {"type": "integer", "description": "Age"},
            },
            "required": ["name"],
        }
        model = _schema_to_pydantic_model("TestModel", schema)
        assert model is not None
        # 验证字段存在
        assert "name" in model.model_fields
        assert "age" in model.model_fields

    def test_empty_schema_returns_none(self):
        model = _schema_to_pydantic_model("Empty", {"type": "object", "properties": {}})
        assert model is None


class TestWrapModuTool:
    def test_wrap_basic_tool(self):
        tool = _FakeModuTool()
        lc_tool = wrap_modu_tool(tool, config=None)
        assert lc_tool is not None
        assert lc_tool.name == "fake_tool"
        assert "fake tool" in lc_tool.description.lower()

    def test_wrap_tool_invoke(self):
        tool = _FakeModuTool()
        lc_tool = wrap_modu_tool(tool, config=None)
        result = lc_tool.invoke({"query": "test", "limit": 5})
        assert "searched: test" in str(result)

    def test_wrap_with_retry_config(self):
        """P2-8: 提供 config 时应启用重试包装。"""
        tool = _FakeModuTool()
        cfg = RuntimeConfig()
        lc_tool = wrap_modu_tool(tool, config=cfg)
        assert lc_tool is not None
        # 正常调用不应受重试包装影响
        result = lc_tool.invoke({"query": "test"})
        assert "searched: test" in str(result)


class TestBuildLangchainTools:
    def test_build_from_empty_registry(self):
        cfg = RuntimeConfig()
        tools = build_langchain_tools(registry=None, config=cfg)
        assert tools == []

    def test_build_from_registry_with_tools(self):
        from core.registry import ComponentRegistry
        reg = ComponentRegistry()
        reg.register_tool(_FakeModuTool())
        cfg = RuntimeConfig()
        tools = build_langchain_tools(registry=reg, config=cfg)
        assert len(tools) == 1
        assert tools[0].name == "fake_tool"
