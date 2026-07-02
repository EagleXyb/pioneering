"""功能测试：core/registry 模块。

P1-12.2.1: legacy `adapters/` 层已废弃删除，统一到 `langgraph/adapters/`。
本文件保留 ComponentRegistry 的功能测试，移除原 LLMAdapter/ToolAdapter/StorageAdapter
测试（这些 legacy 适配器已由 LangGraph 的 build_chat_model / ToolNode / ChromaStore 替代）。
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from core.interfaces.action import BaseActionExecutor, BaseTool
from core.interfaces.feedback import BaseEvolutionSignal, BaseFeedbackLoop
from core.interfaces.memory import BaseMemory, BaseStorageAdapter
from core.interfaces.perception import BasePerception, BaseSensor
from core.interfaces.reasoning import BaseReasoningEngine, BaseReasoningStrategy
from core.registry import (
    ComponentRegistry,
    get_registry,
    override_registry,
    reset_registry,
)


# ======================================================================
#  Mock 组件工厂
# ======================================================================

class MockReasoningEngine(BaseReasoningEngine):
    def reason(self, prompt, context, **kwargs):
        return ("mock response", {"total_tokens": 10}, [])

    def stream(self, prompt, context):
        yield "chunk1"
        yield "chunk2"


class MockTool(BaseTool):
    def __init__(self, name="mock_tool", desc="A mock tool", schema=None):
        self._name = name
        self._desc = desc
        self._schema = schema or {"type": "object", "properties": {}, "required": []}

    def name(self):
        return self._name

    def description(self):
        return self._desc

    def parameters_schema(self):
        return self._schema

    def invoke(self, params, context):
        return {"status": "success", "data": {"result": "mock"}, "error_code": ""}


class MockMemory(BaseMemory):
    def __init__(self):
        self._store = {}

    def query(self, user_id, context_window, required_fields):
        return {"history": self._store.get(user_id, [])}

    def update(self, user_id, new_data, metadata):
        if user_id not in self._store:
            self._store[user_id] = []
        self._store[user_id].append(new_data)
        return True


class MockFailingMemory(BaseMemory):
    def query(self, user_id, context_window, required_fields):
        raise RuntimeError("query failed")

    def update(self, user_id, new_data, metadata):
        raise RuntimeError("update failed")


class MockPerception(BasePerception):
    def perceive(self, input_type, raw_content, language=None, sensitivity_level=0):
        return {"parsed_content": {"text": raw_content.decode("utf-8")}}


class MockSensor(BaseSensor):
    def sensor_type(self):
        return "mock"

    def capture(self, context):
        return b"data"


class MockFeedbackLoop(BaseFeedbackLoop):
    def evaluate(self, output, context):
        return {"score": 0.9}

    def should_evolve(self, metrics, threshold):
        return False


class MockEvolutionSignal(BaseEvolutionSignal):
    def signal_type(self):
        return "mock"

    def generate(self, source, metrics, context):
        return {"signal": "mock"}


class MockStorageAdapter(BaseStorageAdapter):
    def adapter_type(self):
        return "mock"

    def load(self, key):
        return {"key": key}

    def save(self, key, data):
        return True


# ======================================================================
# ComponentRegistry 功能测试
# ======================================================================

class TestComponentRegistryRegistration:
    def test_register_reasoning_engine(self, fresh_registry):
        engine = MockReasoningEngine()
        fresh_registry.register_reasoning_engine("test_engine", engine)
        assert fresh_registry.get_reasoning_engine("test_engine") is engine

    def test_register_reasoning_engine_type_check(self, fresh_registry):
        with pytest.raises(TypeError, match="BaseReasoningEngine"):
            fresh_registry.register_reasoning_engine("bad", object())

    def test_register_tool(self, fresh_registry):
        tool = MockTool()
        fresh_registry.register_tool(tool)
        assert fresh_registry.get_tool("mock_tool") is tool
        assert "mock_tool" in fresh_registry.list_tools()

    def test_register_tool_type_check(self, fresh_registry):
        with pytest.raises(TypeError, match="BaseTool"):
            fresh_registry.register_tool(object())

    def test_register_duplicate_tool_overwrites(self, fresh_registry):
        tool1 = MockTool(name="dup")
        tool2 = MockTool(name="dup", desc="updated")
        fresh_registry.register_tool(tool1)
        fresh_registry.register_tool(tool2)
        assert fresh_registry.get_tool("dup").description() == "updated"

    def test_register_memory(self, fresh_registry):
        mem = MockMemory()
        fresh_registry.register_memory("mem1", mem)
        assert fresh_registry.get_memory("mem1") is mem

    def test_register_perception(self, fresh_registry):
        proc = MockPerception()
        fresh_registry.register_perception("proc1", proc)
        assert fresh_registry.get_perception("proc1") is proc

    def test_register_sensor(self, fresh_registry):
        sensor = MockSensor()
        fresh_registry.register_sensor("s1", sensor)
        assert fresh_registry.get_sensor("s1") is sensor

    def test_register_feedback_loop(self, fresh_registry):
        loop = MockFeedbackLoop()
        fresh_registry.register_feedback_loop("loop1", loop)
        assert fresh_registry.get_feedback_loop("loop1") is loop

    def test_register_evolution_signal(self, fresh_registry):
        sig = MockEvolutionSignal()
        fresh_registry.register_evolution_signal("sig1", sig)
        assert fresh_registry.get_evolution_signal("sig1") is sig

    def test_register_storage_adapter(self, fresh_registry):
        adapter = MockStorageAdapter()
        fresh_registry.register_storage_adapter("ad1", adapter)
        assert fresh_registry.get_storage_adapter("ad1") is adapter


class TestComponentRegistryQuery:
    def test_get_nonexistent_engine(self, fresh_registry):
        assert fresh_registry.get_reasoning_engine("nonexistent") is None

    def test_get_active_engine_returns_first(self, fresh_registry):
        e1 = MockReasoningEngine()
        e2 = MockReasoningEngine()
        fresh_registry.register_reasoning_engine("first", e1)
        fresh_registry.register_reasoning_engine("second", e2)
        assert fresh_registry.get_active_reasoning_engine() is e1

    def test_get_active_engine_empty_returns_none(self, fresh_registry):
        assert fresh_registry.get_active_reasoning_engine() is None

    def test_list_tools_empty(self, fresh_registry):
        assert fresh_registry.list_tools() == {}

    def test_list_tools_multiple(self, fresh_registry):
        fresh_registry.register_tool(MockTool(name="t1"))
        fresh_registry.register_tool(MockTool(name="t2"))
        tools = fresh_registry.list_tools()
        assert len(tools) == 2
        assert "t1" in tools
        assert "t2" in tools

    def test_list_all(self, fresh_registry):
        fresh_registry.register_reasoning_engine("e1", MockReasoningEngine())
        fresh_registry.register_tool(MockTool(name="t1"))
        all_components = fresh_registry.list_all()
        assert "reasoning_engines" in all_components
        assert "tools" in all_components
        assert all_components["reasoning_engines"] == ["e1"]
        assert all_components["tools"] == ["t1"]


class TestComponentRegistrySwap:
    def test_swap_valid_category(self, fresh_registry):
        new_engine = MockReasoningEngine()
        result = fresh_registry.swap_component("reasoning_engine", "e1", new_engine)
        assert result is True
        assert fresh_registry.get_reasoning_engine("e1") is new_engine

    def test_swap_invalid_category(self, fresh_registry):
        result = fresh_registry.swap_component("invalid_category", "x", object())
        assert result is False

    def test_swap_tool(self, fresh_registry):
        new_tool = MockTool(name="new_tool")
        result = fresh_registry.swap_component("tool", "new_tool", new_tool)
        assert result is True
        assert fresh_registry.get_tool("new_tool") is new_tool


class TestComponentRegistryTypeChecks:
    """类型校验边界测试。"""

    def test_memory_type_check(self, fresh_registry):
        with pytest.raises(TypeError, match="BaseMemory"):
            fresh_registry.register_memory("bad", object())

    def test_perception_type_check(self, fresh_registry):
        with pytest.raises(TypeError, match="BasePerception"):
            fresh_registry.register_perception("bad", object())

    def test_sensor_type_check(self, fresh_registry):
        with pytest.raises(TypeError, match="BaseSensor"):
            fresh_registry.register_sensor("bad", object())

    def test_storage_adapter_type_check(self, fresh_registry):
        with pytest.raises(TypeError, match="BaseStorageAdapter"):
            fresh_registry.register_storage_adapter("bad", object())

    def test_feedback_loop_type_check(self, fresh_registry):
        with pytest.raises(TypeError, match="BaseFeedbackLoop"):
            fresh_registry.register_feedback_loop("bad", object())

    def test_evolution_signal_type_check(self, fresh_registry):
        with pytest.raises(TypeError, match="BaseEvolutionSignal"):
            fresh_registry.register_evolution_signal("bad", object())


class TestRegistryGlobal:
    def test_get_registry_creates_singleton(self):
        reset_registry()
        r1 = get_registry()
        r2 = get_registry()
        assert r1 is r2

    def test_get_registry_with_override(self):
        reset_registry()
        custom = ComponentRegistry()
        result = get_registry(override=custom)
        assert result is custom

    def test_override_registry_contextmanager(self):
        reset_registry()
        old = get_registry()
        custom = ComponentRegistry()
        with override_registry(custom) as current:
            assert current is custom
            assert get_registry() is custom
        assert get_registry() is old

    def test_override_registry_restore_on_exception(self):
        reset_registry()
        old = get_registry()
        custom = ComponentRegistry()
        try:
            with override_registry(custom):
                raise ValueError("test")
        except ValueError:
            pass
        assert get_registry() is old
