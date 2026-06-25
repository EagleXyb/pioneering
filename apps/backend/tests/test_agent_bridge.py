"""StreamContext 和 agent_bridge 元数据收集单元测试"""
from __future__ import annotations

import json
import pytest
import time

from app.core.agent_bridge import StreamContext, _collect_metadata_from_event


class TestStreamContext:
    """StreamContext dataclass 测试"""

    def test_default_values(self):
        ctx = StreamContext()
        assert ctx.answer_content == ""
        assert ctx.content_blocks == []
        assert ctx.tool_executions == []
        assert ctx.prompt_tokens == 0
        assert ctx.completion_tokens == 0
        assert ctx.has_error is False
        assert ctx.error_info == {}

    def test_finish_calculates_latency(self):
        ctx = StreamContext()
        ctx.start_time = time.time() - 0.1  # 100ms ago
        ctx.finish()
        assert ctx.latency_ms >= 90  # 允许少量误差
        assert ctx.latency_ms < 200


class TestCollectMetadataFromEvent:
    """_collect_metadata_from_event 函数测试"""

    def test_thinking_start(self):
        ctx = StreamContext()
        event = {"data": json.dumps({"type": "THINKING_START"})}
        _collect_metadata_from_event(event, ctx)
        assert len(ctx.content_blocks) == 1
        assert ctx.content_blocks[0]["type"] == "thinking"
        assert ctx.content_blocks[0]["status"] == "running"

    def test_thinking_content(self):
        ctx = StreamContext()
        # 先添加 thinking start
        _collect_metadata_from_event({"data": json.dumps({"type": "THINKING_START"})}, ctx)
        # 再添加内容
        _collect_metadata_from_event({"data": json.dumps({"type": "THINKING_TEXT_MESSAGE_CONTENT", "delta": "hello"})}, ctx)
        _collect_metadata_from_event({"data": json.dumps({"type": "THINKING_TEXT_MESSAGE_CONTENT", "delta": " world"})}, ctx)
        assert ctx.content_blocks[0]["summary"] == "hello world"

    def test_thinking_end(self):
        ctx = StreamContext()
        _collect_metadata_from_event({"data": json.dumps({"type": "THINKING_START"})}, ctx)
        _collect_metadata_from_event({"data": json.dumps({"type": "THINKING_END"})}, ctx)
        assert ctx.content_blocks[0]["status"] == "success"

    def test_tool_call_start(self):
        ctx = StreamContext()
        event = {"data": json.dumps({"type": "TOOL_CALL_START", "toolCallName": "search", "toolCallId": "tc1"})}
        _collect_metadata_from_event(event, ctx)
        assert len(ctx.content_blocks) == 1
        assert ctx.content_blocks[0]["type"] == "tool_call"
        assert ctx.content_blocks[0]["toolName"] == "search"

    def test_tool_call_result(self):
        ctx = StreamContext()
        _collect_metadata_from_event({"data": json.dumps({"type": "TOOL_CALL_START", "toolCallName": "search", "toolCallId": "tc1"})}, ctx)
        _collect_metadata_from_event({"data": json.dumps({"type": "TOOL_CALL_RESULT", "toolCallName": "search", "toolCallId": "tc1", "content": "found"})}, ctx)
        # 应有 tool_call + tool_result 两个 block
        assert len(ctx.content_blocks) == 2
        assert ctx.content_blocks[0]["status"] == "success"
        assert ctx.content_blocks[1]["type"] == "tool_result"

    def test_text_message_content(self):
        ctx = StreamContext()
        _collect_metadata_from_event({"data": json.dumps({"type": "TEXT_MESSAGE_CONTENT", "delta": "Hi"})}, ctx)
        _collect_metadata_from_event({"data": json.dumps({"type": "TEXT_MESSAGE_CONTENT", "delta": " there"})}, ctx)
        assert len(ctx.content_blocks) == 1
        assert ctx.content_blocks[0]["text"] == "Hi there"

    def test_run_error(self):
        ctx = StreamContext()
        _collect_metadata_from_event({"data": json.dumps({"type": "RUN_ERROR", "code": "ERR", "message": "fail"})}, ctx)
        assert ctx.has_error is True
        assert ctx.error_info["code"] == "ERR"

    def test_empty_data(self):
        ctx = StreamContext()
        _collect_metadata_from_event({"data": ""}, ctx)
        assert len(ctx.content_blocks) == 0

    def test_invalid_json(self):
        ctx = StreamContext()
        _collect_metadata_from_event({"data": "not json"}, ctx)
        assert len(ctx.content_blocks) == 0
