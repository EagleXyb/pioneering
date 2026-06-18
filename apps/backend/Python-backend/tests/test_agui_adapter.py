"""AG-UI 协议适配器单元测试"""
from __future__ import annotations

import json
import os
import sys
import pytest
import asyncio
from typing import Any, AsyncGenerator, Dict

# 将 ModuAgent 目录加入 sys.path
_MODUAGENT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ModuAgent")
if _MODUAGENT_DIR not in sys.path:
    sys.path.insert(0, _MODUAGENT_DIR)

from orchestration.communication.agui_adapter import (
    AGUIEncoder,
    AGUIEventType,
    AGUIStreamAdapter,
    RunStartedEvent,
    RunFinishedEvent,
    RunErrorEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ThinkingStartEvent,
    ThinkingContentEvent,
    ThinkingEndEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallRecord,
)


# ========== AGUIEncoder 测试 ==========


class TestAGUIEncoder:
    """AGUIEncoder.to_sse / to_event_dict 单元测试"""

    def test_to_sse_basic(self):
        result = AGUIEncoder.to_sse(AGUIEventType.RUN_STARTED, {"threadId": "t1", "runId": "r1"})
        assert result.startswith("data: ")
        assert result.endswith("\n\n")
        payload = json.loads(result[6:].strip())
        assert payload["type"] == "RUN_STARTED"
        assert payload["threadId"] == "t1"
        assert payload["runId"] == "r1"

    def test_to_sse_newline_escaping(self):
        """SSE 注入防护：换行符必须被转义，SSE 帧体不含裸换行"""
        result = AGUIEncoder.to_sse(
            AGUIEventType.TEXT_MESSAGE_CONTENT,
            {"delta": "hello\nworld\rline"},
        )
        body = result[:-2]  # 去掉末尾 \n\n
        assert "\n" not in body
        assert "\r" not in body
        # JSON 解析后内容恢复为原始换行符
        payload = json.loads(result[6:].strip())
        assert payload["delta"] == "hello\nworld\rline"

    def test_to_event_dict_basic(self):
        result = AGUIEncoder.to_event_dict(AGUIEventType.RUN_FINISHED, {"threadId": "t1", "runId": "r1"})
        assert "data" in result
        payload = json.loads(result["data"])
        assert payload["type"] == "RUN_FINISHED"

    def test_to_event_dict_newline_escaping(self):
        result = AGUIEncoder.to_event_dict(
            AGUIEventType.TEXT_MESSAGE_CONTENT,
            {"delta": "line1\nline2\rline3"},
        )
        # data 字段中不应含裸换行（JSON 编码后 \n -> \\n）
        assert "\n" not in result["data"]
        assert "\r" not in result["data"]
        # JSON 解析后恢复原始换行
        payload = json.loads(result["data"])
        assert payload["delta"] == "line1\nline2\rline3"

    def test_chinese_content(self):
        result = AGUIEncoder.to_sse(
            AGUIEventType.TEXT_MESSAGE_CONTENT,
            {"delta": "你好世界"},
        )
        payload = json.loads(result[6:].strip())
        assert payload["delta"] == "你好世界"


# ========== Event dataclass 测试 ==========


class TestEventDataclasses:
    """各 Event dataclass 的 to_sse / to_event_dict 方法测试"""

    def test_run_started_event(self):
        event = RunStartedEvent(thread_id="t1", run_id="r1")
        sse = event.to_sse()
        assert "RUN_STARTED" in sse
        d = event.to_event_dict()
        payload = json.loads(d["data"])
        assert payload["type"] == "RUN_STARTED"
        assert payload["threadId"] == "t1"

    def test_run_finished_event(self):
        event = RunFinishedEvent(thread_id="t1", run_id="r1")
        d = event.to_event_dict()
        payload = json.loads(d["data"])
        assert payload["type"] == "RUN_FINISHED"

    def test_run_error_event(self):
        event = RunErrorEvent(code="ERR_001", message="something failed")
        d = event.to_event_dict()
        payload = json.loads(d["data"])
        assert payload["type"] == "RUN_ERROR"
        assert payload["code"] == "ERR_001"

    def test_text_message_start_event(self):
        event = TextMessageStartEvent(message_id="m1", role="assistant")
        d = event.to_event_dict()
        payload = json.loads(d["data"])
        assert payload["type"] == "TEXT_MESSAGE_START"
        assert payload["messageId"] == "m1"

    def test_text_message_content_event(self):
        event = TextMessageContentEvent(message_id="m1", delta="hello")
        d = event.to_event_dict()
        payload = json.loads(d["data"])
        assert payload["delta"] == "hello"

    def test_thinking_start_event(self):
        event = ThinkingStartEvent(title="推理分析")
        d = event.to_event_dict()
        payload = json.loads(d["data"])
        assert payload["type"] == "THINKING_START"
        assert payload["title"] == "推理分析"

    def test_tool_call_start_event(self):
        event = ToolCallStartEvent(tool_call_id="tc1", tool_call_name="search", parent_message_id="m1")
        d = event.to_event_dict()
        payload = json.loads(d["data"])
        assert payload["toolCallName"] == "search"
        assert payload["toolCallId"] == "tc1"


# ========== AGUIStreamAdapter 测试 ==========


async def _make_stream(frames: list[dict[str, Any]]) -> AsyncGenerator[Dict[str, Any], None]:
    """辅助：将 list 转为 async generator"""
    for frame in frames:
        yield frame


class TestAGUIStreamAdapterTransform:
    """AGUIStreamAdapter.transform_streaming_events() 测试"""

    @pytest.mark.asyncio
    async def test_simple_text_response(self):
        """纯文本响应（无工具调用）"""
        frames = [
            {"event": "token", "data": json.dumps({"token": "Hello"})},
            {"event": "token", "data": json.dumps({"token": " world"})},
            {"event": "done", "data": json.dumps({})},
        ]

        adapter = AGUIStreamAdapter(trace_id="test-trace")
        events = []
        async for event_dict in adapter.transform_streaming_events(_make_stream(frames)):
            events.append(event_dict)

        # 验证事件序列
        types = [json.loads(e["data"])["type"] for e in events]
        assert types[0] == "RUN_STARTED"
        assert "TEXT_MESSAGE_START" in types
        assert "TEXT_MESSAGE_CONTENT" in types
        assert "TEXT_MESSAGE_END" in types
        assert types[-1] == "RUN_FINISHED"

        # 验证文本内容
        text_deltas = []
        for e in events:
            payload = json.loads(e["data"])
            if payload["type"] == "TEXT_MESSAGE_CONTENT":
                text_deltas.append(payload["delta"])
        assert text_deltas == ["Hello", " world"]

    @pytest.mark.asyncio
    async def test_thinking_then_text(self):
        """思考 + 文本响应"""
        frames = [
            {"event": "thinking", "data": json.dumps({"content": "Let me think..."})},
            {"event": "token", "data": json.dumps({"token": "The answer is 42"})},
            {"event": "done", "data": json.dumps({})},
        ]

        adapter = AGUIStreamAdapter(trace_id="test-trace")
        events = []
        async for event_dict in adapter.transform_streaming_events(_make_stream(frames)):
            events.append(event_dict)

        types = [json.loads(e["data"])["type"] for e in events]
        assert "THINKING_START" in types
        assert "THINKING_TEXT_MESSAGE_CONTENT" in types
        assert "THINKING_END" in types
        assert "TEXT_MESSAGE_START" in types
        assert "TEXT_MESSAGE_CONTENT" in types

    @pytest.mark.asyncio
    async def test_tool_call_flow(self):
        """工具调用流程"""
        frames = [
            {"event": "tool_call_start", "data": json.dumps({"id": "tc1", "name": "search", "arguments": '{"query": "test"}'})},
            {"event": "tool_call_end", "data": json.dumps({"id": "tc1"})},
            {"event": "tool_result", "data": json.dumps({"id": "tc1", "name": "search", "result": "found", "status": "success"})},
            {"event": "token", "data": json.dumps({"token": "Based on search..."})},
            {"event": "done", "data": json.dumps({})},
        ]

        adapter = AGUIStreamAdapter(trace_id="test-trace")
        events = []
        async for event_dict in adapter.transform_streaming_events(_make_stream(frames)):
            events.append(event_dict)

        types = [json.loads(e["data"])["type"] for e in events]
        assert "TOOL_CALL_START" in types
        assert "TOOL_CALL_ARGS" in types
        assert "TOOL_CALL_END" in types
        assert "TOOL_CALL_RESULT" in types
        assert "TEXT_MESSAGE_CONTENT" in types

        # 验证工具调用记录
        assert len(adapter._tool_call_records) == 1
        assert adapter._tool_call_records[0].tool_name == "search"

    @pytest.mark.asyncio
    async def test_error_event(self):
        """错误事件处理"""
        frames = [
            {"event": "error", "data": json.dumps({"error_code": "LLM_ERROR", "message": "API timeout"})},
        ]

        adapter = AGUIStreamAdapter(trace_id="test-trace")
        events = []
        async for event_dict in adapter.transform_streaming_events(_make_stream(frames)):
            events.append(event_dict)

        types = [json.loads(e["data"])["type"] for e in events]
        assert "RUN_STARTED" in types
        assert "RUN_ERROR" in types
        # RUN_FINISHED 不应在错误后出现
        assert "RUN_FINISHED" not in types

    @pytest.mark.asyncio
    async def test_status_and_iteration_events(self):
        """状态和迭代事件"""
        frames = [
            {"event": "status", "data": json.dumps({"phase": "thinking"})},
            {"event": "reasoning_iteration", "data": json.dumps({"index": 1, "max": 3})},
            {"event": "token", "data": json.dumps({"token": "done"})},
            {"event": "done", "data": json.dumps({})},
        ]

        adapter = AGUIStreamAdapter(trace_id="test-trace")
        events = []
        async for event_dict in adapter.transform_streaming_events(_make_stream(frames)):
            events.append(event_dict)

        types = [json.loads(e["data"])["type"] for e in events]
        assert "STATE_DELTA" in types

    @pytest.mark.asyncio
    async def test_done_with_tool_results(self):
        """done 事件中包含 tool_results"""
        frames = [
            {"event": "done", "data": json.dumps({
                "tool_results": [
                    {"tool": "calculator", "params": {"expr": "1+1"}, "result": 2}
                ]
            })},
        ]

        adapter = AGUIStreamAdapter(trace_id="test-trace")
        events = []
        async for event_dict in adapter.transform_streaming_events(_make_stream(frames)):
            events.append(event_dict)

        types = [json.loads(e["data"])["type"] for e in events]
        assert "TOOL_CALL_START" in types
        assert "TOOL_CALL_RESULT" in types

    @pytest.mark.asyncio
    async def test_collected_text(self):
        """验证 _collected_text 属性"""
        frames = [
            {"event": "token", "data": json.dumps({"token": "Hello"})},
            {"event": "token", "data": json.dumps({"token": " there"})},
            {"event": "done", "data": json.dumps({})},
        ]

        adapter = AGUIStreamAdapter(trace_id="test-trace")
        async for _ in adapter.transform_streaming_events(_make_stream(frames)):
            pass

        assert adapter._collected_text == "Hello there"


class TestAGUIStreamAdapterParseToolRecords:
    """_parse_tool_records 静态方法测试"""

    def test_parse_with_tool_key(self):
        records = AGUIStreamAdapter._parse_tool_records([
            {"tool": "search", "params": {"q": "test"}, "result": "found"}
        ])
        assert len(records) == 1
        assert records[0].tool_name == "search"

    def test_parse_with_tool_name_key(self):
        records = AGUIStreamAdapter._parse_tool_records([
            {"tool_name": "calculator", "parameters": {"expr": "1+1"}, "result": 2}
        ])
        assert len(records) == 1
        assert records[0].tool_name == "calculator"

    def test_parse_empty_list(self):
        records = AGUIStreamAdapter._parse_tool_records([])
        assert records == []

    def test_parse_non_dict_items(self):
        records = AGUIStreamAdapter._parse_tool_records(["not a dict", 123])
        assert records == []

    def test_parse_missing_tool_name(self):
        records = AGUIStreamAdapter._parse_tool_records([
            {"params": {"q": "test"}, "result": "found"}
        ])
        # 没有 tool/tool_name，不应生成记录
        assert len(records) == 0


# ========== 集成测试：完整事件流序列验证 ==========


class TestFullEventStreamIntegration:
    """完整事件流序列集成测试"""

    @pytest.mark.asyncio
    async def test_complete_react_flow(self):
        """模拟完整 ReAct 循环：思考 → 工具调用 → 工具结果 → 文本响应"""
        frames = [
            {"event": "status", "data": json.dumps({"phase": "thinking"})},
            {"event": "thinking", "data": json.dumps({"content": "I need to search for this."})},
            {"event": "tool_call_start", "data": json.dumps({"id": "tc1", "name": "search", "arguments": '{"query": "pioneering"}'})},
            {"event": "tool_call_end", "data": json.dumps({"id": "tc1"})},
            {"event": "tool_result", "data": json.dumps({"id": "tc1", "name": "search", "result": "Pioneering is...", "status": "success"})},
            {"event": "reasoning_iteration", "data": json.dumps({"index": 2, "max": 3})},
            {"event": "token", "data": json.dumps({"token": "Based on my search, "})},
            {"event": "token", "data": json.dumps({"token": "pioneering means..."})},
            {"event": "done", "data": json.dumps({})},
        ]

        adapter = AGUIStreamAdapter(trace_id="integration-test")
        events = []
        async for event_dict in adapter.transform_streaming_events(_make_stream(frames)):
            events.append(event_dict)

        types = [json.loads(e["data"])["type"] for e in events]

        # 验证完整序列
        assert types[0] == "RUN_STARTED"
        assert "STATE_DELTA" in types
        assert "THINKING_START" in types
        assert "THINKING_TEXT_MESSAGE_CONTENT" in types
        assert "THINKING_END" in types
        assert "TOOL_CALL_START" in types
        assert "TOOL_CALL_ARGS" in types
        assert "TOOL_CALL_END" in types
        assert "TOOL_CALL_RESULT" in types
        assert "TEXT_MESSAGE_START" in types
        assert "TEXT_MESSAGE_CONTENT" in types
        assert "TEXT_MESSAGE_END" in types
        assert types[-1] == "RUN_FINISHED"

        # 验证事件顺序：RUN_STARTED 必须在最前，RUN_FINISHED 必须在最后
        assert types.index("RUN_STARTED") == 0
        assert types.index("RUN_FINISHED") == len(types) - 1

        # 验证 TEXT_MESSAGE_START 在 TEXT_MESSAGE_CONTENT 之前
        assert types.index("TEXT_MESSAGE_START") < types.index("TEXT_MESSAGE_CONTENT")

        # 验证 THINKING_START 在 THINKING_END 之前
        assert types.index("THINKING_START") < types.index("THINKING_END")

        # 验证 TOOL_CALL_START 在 TOOL_CALL_RESULT 之前
        assert types.index("TOOL_CALL_START") < types.index("TOOL_CALL_RESULT")
