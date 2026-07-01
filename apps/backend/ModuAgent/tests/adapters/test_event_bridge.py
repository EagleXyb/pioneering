"""LangGraphEventBridge 单元测试（P2-4）。

覆盖：
    - messages stream → REASONING.STREAM 映射
    - updates stream → 节点域/动作映射（perception/memory_query/tools/agent）
    - custom stream → 自定义事件
    - SSE 细粒度事件（thinking/tool_call_start/tool_result）
    - 事件透传
    - EventBus 发布

注意：event_bridge.py 本身不依赖 langchain_core，但位于 langgraph/ 包下。
为绕过 langgraph/__init__.py 对 langchain_core 的依赖，使用 importlib 直接加载模块。
"""
import asyncio
import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType

import pytest

# ---- 用 importlib 加载 event_bridge.py，绕过 langgraph/__init__.py ----
_MODU_ROOT = Path(__file__).resolve().parents[2]
_BRIDGE_PATH = _MODU_ROOT / "langgraph" / "adapters" / "event_bridge.py"


def _load_event_bridge() -> ModuleType:
    """直接加载 event_bridge.py 模块文件，不触发 langgraph/__init__.py。"""
    # 确保 orchestration 和 config 等依赖模块可被导入
    if str(_MODU_ROOT) not in sys.path:
        sys.path.insert(0, str(_MODU_ROOT))

    spec = importlib.util.spec_from_file_location(
        "moduagent_event_bridge", _BRIDGE_PATH
    )
    if spec is None or spec.loader is None:
        pytest.skip("无法加载 event_bridge.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# 加载模块
_bridge_module = _load_event_bridge()
LangGraphEventBridge = _bridge_module.LangGraphEventBridge

from orchestration.communication.message_bus import EventBus
from orchestration.communication.protocol import (
    AgentEvent,
    EventAction,
    EventDomain,
    EventPriority,
)


async def _async_gen(events):
    """将列表转为异步生成器。"""
    for e in events:
        yield e


class TestMapToAgentEvent:
    def test_messages_stream_returns_none_for_non_10th_token(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")
        event = {"type": "messages", "event": {}}
        result = bridge._map_to_agent_event(event)
        # 前 9 个 token 返回 None
        assert result is None

    def test_messages_stream_returns_stream_event_on_10th_token(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")
        # 发送 9 个 messages 事件
        for _ in range(9):
            bridge._map_to_agent_event({"type": "messages", "event": {}})
        # 第 10 个应返回 STREAM 事件
        result = bridge._map_to_agent_event({"type": "messages", "event": {}})
        assert result is not None
        assert result.domain == EventDomain.REASONING
        assert result.action == EventAction.STREAM

    def test_updates_perception_node(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")
        event = {
            "type": "updates",
            "node": "perception",
            "data": {
                "sensitivity_level": 2,
                "confidence": 0.9,
                "perception_result": None,
            },
        }
        result = bridge._map_to_agent_event(event)
        assert result is not None
        assert result.domain == EventDomain.PERCEPTION
        assert result.action == EventAction.ANALYZE
        assert result.metadata["sensitivity_level"] == "2"
        assert result.metadata["confidence"] == "0.9"

    def test_updates_memory_query_node(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")
        event = {
            "type": "updates",
            "node": "memory_query",
            "data": {"knowledge": [{"content": "test"}]},
        }
        result = bridge._map_to_agent_event(event)
        assert result is not None
        assert result.domain == EventDomain.MEMORY
        assert result.action == EventAction.QUERY
        assert result.metadata["has_knowledge"] == "True"

    def test_updates_memory_query_empty(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")
        event = {
            "type": "updates",
            "node": "memory_query",
            "data": {"knowledge": []},
        }
        result = bridge._map_to_agent_event(event)
        assert result.metadata["has_knowledge"] == "False"

    def test_updates_unknown_node_returns_none(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")
        event = {"type": "updates", "node": "unknown_node", "data": {}}
        result = bridge._map_to_agent_event(event)
        assert result is None

    def test_custom_stream_with_domain_action(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")
        event = {
            "type": "custom",
            "data": {
                "domain": EventDomain.NLP,
                "action": EventAction.NOTIFY,
                "metadata": {"risk": "high"},
            },
        }
        result = bridge._map_to_agent_event(event)
        assert result is not None
        assert result.domain == EventDomain.NLP
        assert result.action == EventAction.NOTIFY
        assert result.metadata["risk"] == "high"

    def test_custom_stream_missing_domain_returns_none(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")
        event = {"type": "custom", "data": {"action": "test"}}
        result = bridge._map_to_agent_event(event)
        assert result is None

    def test_unknown_event_type_returns_none(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")
        event = {"type": "unknown_type"}
        result = bridge._map_to_agent_event(event)
        assert result is None


class TestConsumeAndPassthrough:
    async def test_consume_passes_through_events(self):
        received_events = []

        async def handler(event):
            received_events.append(event)

        bus = EventBus()
        bus.subscribe(handler)
        bridge = LangGraphEventBridge(event_bus=bus, user_id="test-user", session_id="test-session")

        input_events = [
            {"type": "updates", "node": "perception", "data": {"sensitivity_level": 0}},
            {"type": "messages", "event": {}},
        ]

        output = []
        async for evt in bridge.consume(_async_gen(input_events)):
            output.append(evt)

        # 透传原始事件（2 个输入事件）
        assert len(output) == 2
        assert output[0] == input_events[0]
        assert output[1] == input_events[1]

    async def test_consume_publishes_to_event_bus(self):
        received = []

        async def handler(event):
            received.append(event)

        bus = EventBus()
        bus.subscribe(handler)
        bridge = LangGraphEventBridge(event_bus=bus, user_id="test-user", session_id="test-session")

        # perception 节点更新会发布事件
        input_events = [
            {"type": "updates", "node": "perception", "data": {"sensitivity_level": 0}},
        ]
        async for _ in bridge.consume(_async_gen(input_events)):
            pass

        assert len(received) == 1
        assert received[0].domain == EventDomain.PERCEPTION


class TestSSEEvents:
    def test_sse_thinking_on_ai_message(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")

        class FakeAIMessage:
            type = "ai"

        event = {"type": "messages", "event": FakeAIMessage()}
        sse_events = bridge._emit_sse_events(event)
        assert len(sse_events) == 1
        assert sse_events[0]["type"] == "thinking"
        assert sse_events[0]["data"]["status"] == "started"

    def test_sse_thinking_only_once(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")

        class FakeAIMessage:
            type = "ai"

        event = {"type": "messages", "event": FakeAIMessage()}
        # 第一次发射 thinking
        bridge._emit_sse_events(event)
        # 第二次不应再发射
        sse_events = bridge._emit_sse_events(event)
        assert len(sse_events) == 0

    def test_sse_tool_result(self):
        bridge = LangGraphEventBridge(event_bus=EventBus(), user_id="test-user", session_id="test-session")

        class FakeToolMessage:
            type = "tool"
            tool_call_id = "tc_1"
            name = "calculator"
            content = "42"

        event = {
            "type": "updates",
            "node": "tools",
            "data": {"messages": [FakeToolMessage()]},
        }
        sse_events = bridge._emit_sse_events(event)
        assert len(sse_events) == 1
        assert sse_events[0]["type"] == "tool_result"
        assert sse_events[0]["data"]["tool_name"] == "calculator"
        assert sse_events[0]["data"]["result"] == "42"
