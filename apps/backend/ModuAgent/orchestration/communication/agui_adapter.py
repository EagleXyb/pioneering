from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncGenerator, Dict, List, Optional

logger = logging.getLogger(__name__)


class AGUIEventType(str, Enum):
    RUN_STARTED = "RUN_STARTED"
    RUN_FINISHED = "RUN_FINISHED"
    RUN_ERROR = "RUN_ERROR"
    TEXT_MESSAGE_START = "TEXT_MESSAGE_START"
    TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT"
    TEXT_MESSAGE_END = "TEXT_MESSAGE_END"
    TEXT_MESSAGE_CHUNK = "TEXT_MESSAGE_CHUNK"
    THINKING_START = "THINKING_START"
    THINKING_END = "THINKING_END"
    THINKING_TEXT_MESSAGE_START = "THINKING_TEXT_MESSAGE_START"
    THINKING_TEXT_MESSAGE_CONTENT = "THINKING_TEXT_MESSAGE_CONTENT"
    THINKING_TEXT_MESSAGE_END = "THINKING_TEXT_MESSAGE_END"
    TOOL_CALL_START = "TOOL_CALL_START"
    TOOL_CALL_ARGS = "TOOL_CALL_ARGS"
    TOOL_CALL_END = "TOOL_CALL_END"
    TOOL_CALL_CHUNK = "TOOL_CALL_CHUNK"
    TOOL_CALL_RESULT = "TOOL_CALL_RESULT"
    STATE_SNAPSHOT = "STATE_SNAPSHOT"
    STATE_DELTA = "STATE_DELTA"
    MESSAGES_SNAPSHOT = "MESSAGES_SNAPSHOT"


@dataclass
class RunStartedEvent:
    thread_id: str = ""
    run_id: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.RUN_STARTED,
            {"threadId": self.thread_id, "runId": self.run_id},
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.RUN_STARTED,
            {"threadId": self.thread_id, "runId": self.run_id},
        )


@dataclass
class RunFinishedEvent:
    thread_id: str = ""
    run_id: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.RUN_FINISHED,
            {"threadId": self.thread_id, "runId": self.run_id},
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.RUN_FINISHED,
            {"threadId": self.thread_id, "runId": self.run_id},
        )


@dataclass
class RunErrorEvent:
    code: str = ""
    message: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.RUN_ERROR,
            {"code": self.code, "message": self.message},
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.RUN_ERROR,
            {"code": self.code, "message": self.message},
        )


@dataclass
class TextMessageStartEvent:
    message_id: str = ""
    role: str = "assistant"

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.TEXT_MESSAGE_START,
            {"messageId": self.message_id, "role": self.role},
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.TEXT_MESSAGE_START,
            {"messageId": self.message_id, "role": self.role},
        )


@dataclass
class TextMessageContentEvent:
    message_id: str = ""
    delta: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.TEXT_MESSAGE_CONTENT,
            {"messageId": self.message_id, "delta": self.delta},
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.TEXT_MESSAGE_CONTENT,
            {"messageId": self.message_id, "delta": self.delta},
        )


@dataclass
class TextMessageEndEvent:
    message_id: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.TEXT_MESSAGE_END,
            {"messageId": self.message_id},
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.TEXT_MESSAGE_END,
            {"messageId": self.message_id},
        )


@dataclass
class ThinkingStartEvent:
    title: str = "深度思考"

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.THINKING_START,
            {"title": self.title},
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.THINKING_START,
            {"title": self.title},
        )


@dataclass
class ThinkingContentEvent:
    delta: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT,
            {"delta": self.delta},
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT,
            {"delta": self.delta},
        )


@dataclass
class ThinkingEndEvent:
    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(AGUIEventType.THINKING_END, {})

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(AGUIEventType.THINKING_END, {})


@dataclass
class ToolCallStartEvent:
    tool_call_id: str = ""
    tool_call_name: str = ""
    parent_message_id: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.TOOL_CALL_START,
            {
                "toolCallId": self.tool_call_id,
                "toolCallName": self.tool_call_name,
                "parentMessageId": self.parent_message_id,
            },
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.TOOL_CALL_START,
            {
                "toolCallId": self.tool_call_id,
                "toolCallName": self.tool_call_name,
                "parentMessageId": self.parent_message_id,
            },
        )


@dataclass
class ToolCallArgsEvent:
    tool_call_id: str = ""
    delta: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.TOOL_CALL_ARGS,
            {"toolCallId": self.tool_call_id, "delta": self.delta},
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.TOOL_CALL_ARGS,
            {"toolCallId": self.tool_call_id, "delta": self.delta},
        )


@dataclass
class ToolCallEndEvent:
    tool_call_id: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.TOOL_CALL_END,
            {"toolCallId": self.tool_call_id},
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.TOOL_CALL_END,
            {"toolCallId": self.tool_call_id},
        )


@dataclass
class ToolCallResultEvent:
    message_id: str = ""
    tool_call_id: str = ""
    tool_call_name: str = ""
    content: str = ""
    role: str = "tool"
    # P4: 透传工具执行状态，使前端能区分成功/失败（默认空串，旧消费者忽略即可）
    status: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.TOOL_CALL_RESULT,
            {
                "messageId": self.message_id,
                "toolCallId": self.tool_call_id,
                "toolCallName": self.tool_call_name,
                "content": self.content,
                "status": self.status,
                "role": self.role,
            },
        )

    def to_event_dict(self) -> Dict[str, str]:
        return AGUIEncoder.to_event_dict(
            AGUIEventType.TOOL_CALL_RESULT,
            {
                "messageId": self.message_id,
                "toolCallId": self.tool_call_id,
                "toolCallName": self.tool_call_name,
                "content": self.content,
                "status": self.status,
                "role": self.role,
            },
        )


@dataclass
class ToolCallRecord:
    tool_name: str
    params: Dict[str, Any] = field(default_factory=dict)
    result: Dict[str, Any] = field(default_factory=dict)


class AGUIEncoder:
    @staticmethod
    def to_sse(event_type: AGUIEventType, data: Dict[str, Any]) -> str:
        payload = json.dumps({"type": event_type.value, **data}, ensure_ascii=False)
        # 防止 SSE 注入：转义 payload 中的换行符
        payload = payload.replace("\n", "\\n").replace("\r", "\\r")
        return f"data: {payload}\n\n"

    @staticmethod
    def to_event_dict(event_type: AGUIEventType, data: Dict[str, Any]) -> Dict[str, str]:
        """产出兼容 sse_starlette EventSourceResponse 的 dict 格式。"""
        payload = json.dumps({"type": event_type.value, **data}, ensure_ascii=False)
        payload = payload.replace("\n", "\\n").replace("\r", "\\r")
        return {"data": payload}


# P2-12.2.5: 流处理哨兵——表示应停止迭代（错误或 done 事件）
_STREAM_STOP_SENTINEL = object()


class AGUIStateMachine:
    """AG-UI 事件流状态机（P2-12.2.5）。

    统一管理 AGUIStreamAdapter 各 transform 方法中重复的状态跟踪逻辑：
    - thinking_started / text_message_started 懒启动
    - error 处理与短路
    - tool_call 生命周期跟踪（pending → record）
    - 生命周期事件产出（RunStarted / RunFinished / ThinkingEnd / TextMessageEnd）

    支持两种输出格式：
    - "sse": 原始 SSE 字符串（data: {...}\\n\\n）
    - "dict": {"data": "..."} 兼容 sse_starlette EventSourceResponse

    用法：
        sm = AGUIStateMachine(trace_id, message_id, "dict")
        yield sm.emit_run_started()
        for event in input_stream:
            for agui_event in sm.process_coordinator_frame(event_type, data):
                yield agui_event
        for closing in sm.emit_closing():
            yield closing
    """

    def __init__(
        self,
        trace_id: str,
        message_id: str,
        output_format: str = "dict",
    ) -> None:
        self.trace_id = trace_id
        self.message_id = message_id
        self.output_format = output_format

        # 状态标志
        self.thinking_started = False
        self.text_message_started = False
        self.has_error = False
        self.response_text = ""
        self.collected_text = ""

        # 工具调用跟踪
        self.pending_tool_calls: Dict[str, Dict[str, Any]] = {}
        self.tool_call_records: List[ToolCallRecord] = []

    def _emit(self, event_type: AGUIEventType, data: Dict[str, Any]) -> Dict[str, str]:
        """产出单个 AGUI 事件（根据 output_format 选择格式）。"""
        if self.output_format == "sse":
            return AGUIEncoder.to_sse(event_type, data)
        return AGUIEncoder.to_event_dict(event_type, data)

    # ---- 生命周期事件 ----

    def emit_run_started(self) -> Dict[str, str]:
        return self._emit(
            AGUIEventType.RUN_STARTED,
            {"threadId": self.trace_id, "runId": self.trace_id},
        )

    def emit_run_finished(self) -> Dict[str, str]:
        return self._emit(
            AGUIEventType.RUN_FINISHED,
            {"threadId": self.trace_id, "runId": self.trace_id},
        )

    def emit_run_error(self, code: str, message: str) -> Dict[str, str]:
        self.has_error = True
        return self._emit(
            AGUIEventType.RUN_ERROR,
            {"code": code, "message": message},
        )

    # ---- 思考事件 ----

    def emit_thinking(self, content: str, chunk_size: int = 30) -> List[Dict[str, str]]:
        """产出思考事件（懒启动 THINKING_START + 分块 THINKING_CONTENT）。"""
        events: List[Dict[str, str]] = []
        if not self.thinking_started:
            events.append(self._emit(
                AGUIEventType.THINKING_START, {"title": "深度思考"},
            ))
            self.thinking_started = True
        if content:
            for i in range(0, len(content), chunk_size):
                events.append(self._emit(
                    AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT,
                    {"delta": content[i:i + chunk_size]},
                ))
        return events

    def emit_thinking_end(self) -> Optional[Dict[str, str]]:
        """结束思考块（如已启动）。"""
        if self.thinking_started:
            return self._emit(AGUIEventType.THINKING_END, {})
        return None

    # ---- 文本消息事件 ----

    def emit_token(self, token: str) -> List[Dict[str, str]]:
        """产出 token 事件（懒启动 TEXT_MESSAGE_START + TEXT_MESSAGE_CONTENT）。"""
        self.response_text += token
        self.collected_text = self.response_text
        events: List[Dict[str, str]] = []
        if not self.text_message_started:
            events.append(self._emit(
                AGUIEventType.TEXT_MESSAGE_START,
                {"messageId": self.message_id, "role": "assistant"},
            ))
            self.text_message_started = True
        events.append(self._emit(
            AGUIEventType.TEXT_MESSAGE_CONTENT,
            {"messageId": self.message_id, "delta": token},
        ))
        return events

    def emit_text_content(self, content: str) -> List[Dict[str, str]]:
        """产出完整文本内容（非流式一次性输出）。"""
        self.response_text += content
        events: List[Dict[str, str]] = []
        if not self.text_message_started:
            events.append(self._emit(
                AGUIEventType.TEXT_MESSAGE_START,
                {"messageId": self.message_id, "role": "assistant"},
            ))
            self.text_message_started = True
        events.append(self._emit(
            AGUIEventType.TEXT_MESSAGE_CONTENT,
            {"messageId": self.message_id, "delta": content},
        ))
        return events

    def emit_text_end(self) -> List[Dict[str, str]]:
        """结束文本消息（处理未启动但有 response_text 的情况）。"""
        events: List[Dict[str, str]] = []
        if self.text_message_started:
            events.append(self._emit(
                AGUIEventType.TEXT_MESSAGE_END,
                {"messageId": self.message_id},
            ))
        elif self.response_text:
            events.append(self._emit(
                AGUIEventType.TEXT_MESSAGE_START,
                {"messageId": self.message_id, "role": "assistant"},
            ))
            events.append(self._emit(
                AGUIEventType.TEXT_MESSAGE_CONTENT,
                {"messageId": self.message_id, "delta": self.response_text},
            ))
            events.append(self._emit(
                AGUIEventType.TEXT_MESSAGE_END,
                {"messageId": self.message_id},
            ))
        return events

    # ---- 工具调用事件 ----

    def emit_tool_call_start(
        self,
        tool_id: str,
        tool_name: str,
        args_str: str = "{}",
    ) -> List[Dict[str, str]]:
        """产出工具调用开始事件（含参数流式输出）。"""
        events: List[Dict[str, str]] = []
        self.pending_tool_calls[tool_id] = {
            "tool_name": tool_name,
            "arguments": args_str,
        }
        events.append(self._emit(
            AGUIEventType.TOOL_CALL_START,
            {
                "toolCallId": tool_id,
                "toolCallName": tool_name,
                "parentMessageId": self.message_id,
            },
        ))
        if args_str and args_str != "{}":
            events.append(self._emit(
                AGUIEventType.TOOL_CALL_ARGS,
                {"toolCallId": tool_id, "delta": args_str},
            ))
        return events

    def emit_tool_call_end(self, tool_id: str) -> Optional[Dict[str, str]]:
        """产出工具调用结束事件。"""
        if tool_id in self.pending_tool_calls:
            return self._emit(
                AGUIEventType.TOOL_CALL_END,
                {"toolCallId": tool_id},
            )
        return None

    def emit_tool_result(
        self,
        tool_id: str,
        tool_name: str,
        result_str: str,
        status: str = "unknown",
    ) -> List[Dict[str, str]]:
        """产出工具执行结果事件，并记录到 tool_call_records。"""
        events: List[Dict[str, str]] = []
        if tool_id in self.pending_tool_calls:
            tool_name = tool_name or self.pending_tool_calls[tool_id]["tool_name"]
            params = json.loads(
                self.pending_tool_calls[tool_id].get("arguments", "{}"),
            )
            self.tool_call_records.append(ToolCallRecord(
                tool_name=tool_name,
                params=params,
                result={"data": result_str, "status": status},
            ))
        events.append(self._emit(
            AGUIEventType.TOOL_CALL_RESULT,
            {
                "messageId": self.message_id,
                "toolCallId": tool_id,
                "toolCallName": tool_name,
                "content": result_str,
                "status": status,
            },
        ))
        return events

    # ---- 状态增量事件 ----

    def emit_state_delta(self, **kwargs: Any) -> Dict[str, str]:
        """产出 STATE_DELTA 事件（阶段切换/迭代进度等）。"""
        data = {"traceId": self.trace_id, **kwargs}
        return self._emit(AGUIEventType.STATE_DELTA, data)

    # ---- 批量结束事件 ----

    def emit_tool_records_batch(self) -> List[Dict[str, str]]:
        """批量产出已完成工具记录的 AGUI 事件（transform 批量模式用）。"""
        events: List[Dict[str, str]] = []
        for record in self.tool_call_records:
            tool_call_id = str(uuid.uuid4())
            events.append(self._emit(
                AGUIEventType.TOOL_CALL_START,
                {
                    "toolCallId": tool_call_id,
                    "toolCallName": record.tool_name,
                    "parentMessageId": self.message_id,
                },
            ))
            params_json = json.dumps(record.params, ensure_ascii=False)
            if params_json and params_json != "{}":
                events.append(self._emit(
                    AGUIEventType.TOOL_CALL_ARGS,
                    {"toolCallId": tool_call_id, "delta": params_json},
                ))
            events.append(self._emit(
                AGUIEventType.TOOL_CALL_END,
                {"toolCallId": tool_call_id},
            ))
            result_content = json.dumps(record.result, ensure_ascii=False)
            events.append(self._emit(
                AGUIEventType.TOOL_CALL_RESULT,
                {
                    "messageId": self.message_id,
                    "toolCallId": tool_call_id,
                    "toolCallName": record.tool_name,
                    "content": result_content,
                },
            ))
        return events

    def emit_extra_tool_records(self, raw_tool_results: List[Any]) -> List[Dict[str, str]]:
        """处理 done 事件中附加的 tool_results，补充未记录的工具调用。"""
        events: List[Dict[str, str]] = []
        extra_records = AGUIStreamAdapter._parse_tool_records(raw_tool_results)
        existing_names = {r.tool_name for r in self.tool_call_records}
        for rec in extra_records:
            if rec.tool_name not in existing_names:
                self.tool_call_records.append(rec)
                tc_id = str(uuid.uuid4())
                events.append(self._emit(
                    AGUIEventType.TOOL_CALL_START,
                    {
                        "toolCallId": tc_id,
                        "toolCallName": rec.tool_name,
                        "parentMessageId": self.message_id,
                    },
                ))
                events.append(self._emit(
                    AGUIEventType.TOOL_CALL_END,
                    {"toolCallId": tc_id},
                ))
                events.append(self._emit(
                    AGUIEventType.TOOL_CALL_RESULT,
                    {
                        "messageId": self.message_id,
                        "toolCallId": tc_id,
                        "toolCallName": rec.tool_name,
                        "content": json.dumps(rec.result, ensure_ascii=False),
                    },
                ))
        return events

    def emit_closing(self) -> List[Dict[str, str]]:
        """产出所有结束事件（ThinkingEnd + TextEnd + RunFinished）。"""
        events: List[Dict[str, str]] = []
        thinking_end = self.emit_thinking_end()
        if thinking_end is not None:
            events.append(thinking_end)
        events.extend(self.emit_text_end())
        events.append(self.emit_run_finished())
        return events


class AGUIStreamAdapter:
    """
    将 ModuAgent 事件流转换为 AG-UI 标准 SSE 事件流。

    支持两种输入格式：
    1. Coordinator 风格 SSE 帧（transform/transform_streaming/transform_streaming_events）：
       frame = {"event": "token|error|done", "data": "<json_string>"}
    2. LangGraph stream 事件（transform_langgraph/transform_langgraph_events）：
       event = {"type": "messages|updates|values", ...}

    P0-2: LangGraph 成为唯一引擎，推荐使用 transform_langgraph_events()。
    transform_streaming_events() 保留用于兼容旧格式 SSE 帧输入。
    """

    def __init__(self, trace_id: str = ""):
        self._trace_id: str = trace_id
        self._message_id: str = ""
        self._tool_call_records: List[ToolCallRecord] = []
        self._pending_tool_calls: Dict[str, Dict[str, Any]] = {}

    async def transform(
        self,
        coordinator_stream: AsyncGenerator[Dict[str, Any], None],
    ) -> AsyncGenerator[str, None]:
        """
        消费 SSE frame 流，产出 AG-UI 格式的 SSE 字符串流。

        用法：
            adapter = AGUIStreamAdapter(trace_id="xxx")
            async for agui_frame in adapter.transform(stream):
                yield agui_frame
        """
        if not self._trace_id:
            self._trace_id = str(uuid.uuid4())
        self._message_id = str(uuid.uuid4())

        yield RunStartedEvent(
            thread_id=self._trace_id,
            run_id=self._trace_id,
        ).to_sse()

        tool_records: List[ToolCallRecord] = []
        response_text = ""
        has_error = False
        error_code = ""
        error_message = ""

        async for frame in coordinator_stream:
            event_type = frame.get("event", "")
            data_str = frame.get("data", "{}")

            try:
                data = json.loads(data_str) if isinstance(data_str, str) else data_str
            except json.JSONDecodeError:
                logger.warning("Failed to parse Coordinator frame data: %s", data_str[:200])
                continue

            if event_type == "status" or event_type == "reasoning_iteration":
                continue

            elif event_type == "thinking":
                response_text += data.get("content", "")

            elif event_type == "tool_call_start":
                tc_data = {"tool_name": data.get("name", ""), "arguments": data.get("arguments", "{}")}
                pending_tc_id = data.get("id", str(uuid.uuid4()))
                self._pending_tool_calls[pending_tc_id] = tc_data

            elif event_type == "tool_call_end":
                pass

            elif event_type == "tool_result":
                rec_tool_name = data.get("name", "")
                tc_id = data.get("id", "")
                if tc_id in self._pending_tool_calls:
                    rec_tool_name = rec_tool_name or self._pending_tool_calls[tc_id]["tool_name"]
                result_str = data.get("result", "{}")
                result_status = data.get("status", "unknown")
                tool_records.append(ToolCallRecord(
                    tool_name=rec_tool_name,
                    params=json.loads(self._pending_tool_calls.get(tc_id, {}).get("arguments", "{}")),
                    result={"data": result_str, "status": result_status},
                ))

            elif event_type == "error":
                has_error = True
                error_code = data.get("error_code", "")
                error_message = data.get("message", "")
                yield RunErrorEvent(code=error_code, message=error_message).to_sse()
                return

            elif event_type == "token":
                response_text += data.get("token", "")

            elif event_type == "done":
                raw_tool_results = data.get("tool_results", [])
                extra_records = self._parse_tool_records(raw_tool_results)
                existing_names = {r.tool_name for r in tool_records}
                for rec in extra_records:
                    if rec.tool_name not in existing_names:
                        tool_records.append(rec)
                break

        if has_error:
            return

        for tool_record in tool_records:
            tool_call_id = str(uuid.uuid4())
            self._tool_call_records.append(tool_record)

            yield ToolCallStartEvent(
                tool_call_id=tool_call_id,
                tool_call_name=tool_record.tool_name,
                parent_message_id=self._message_id,
            ).to_sse()

            params_json = json.dumps(tool_record.params, ensure_ascii=False)
            if params_json and params_json != "{}":
                yield ToolCallArgsEvent(
                    tool_call_id=tool_call_id,
                    delta=params_json,
                ).to_sse()

            yield ToolCallEndEvent(tool_call_id=tool_call_id).to_sse()

            result_content = json.dumps(tool_record.result, ensure_ascii=False)
            yield ToolCallResultEvent(
                message_id=self._message_id,
                tool_call_id=tool_call_id,
                tool_call_name=tool_record.tool_name,
                content=result_content,
            ).to_sse()

        yield TextMessageStartEvent(message_id=self._message_id).to_sse()

        if response_text:
            yield TextMessageContentEvent(
                message_id=self._message_id,
                delta=response_text,
            ).to_sse()

        yield TextMessageEndEvent(message_id=self._message_id).to_sse()

        yield RunFinishedEvent(
            thread_id=self._trace_id,
            run_id=self._trace_id,
        ).to_sse()

    @staticmethod
    def _parse_tool_records(
        raw_tool_results: List[Any],
    ) -> List[ToolCallRecord]:
        records: List[ToolCallRecord] = []
        for item in raw_tool_results:
            if not isinstance(item, dict):
                continue
            tool_name = item.get("tool", item.get("tool_name", ""))
            params = item.get("params", item.get("parameters", {}))
            result = item.get("result", item)

            if not tool_name and isinstance(result, dict):
                tool_name = result.get("tool", "")

            if tool_name:
                records.append(
                    ToolCallRecord(
                        tool_name=tool_name,
                        params=params if isinstance(params, dict) else {},
                        result=result if isinstance(result, dict) else {"data": str(result)},
                    )
                )
        return records

    async def transform_streaming(
        self,
        coordinator_stream: AsyncGenerator[Dict[str, Any], None],
    ) -> AsyncGenerator[str, None]:
        """
        流式转换：逐帧消费 SSE 帧输出，实时产出 AG-UI SSE 事件流。

        P2-12.2.5: 使用 AGUIStateMachine 统一状态管理，消除与
        transform_streaming_events 的重复逻辑。

        与 transform() 的区别：
        - transform() 先收集所有事件再一次性输出
        - transform_streaming() 边消费边输出，实现真正的实时流式体验
        """
        if not self._trace_id:
            self._trace_id = str(uuid.uuid4())
        self._message_id = str(uuid.uuid4())

        sm = AGUIStateMachine(self._trace_id, self._message_id, "sse")

        yield sm.emit_run_started()

        async for frame in coordinator_stream:
            event_type = frame.get("event", "")
            data_str = frame.get("data", "{}")

            try:
                data = json.loads(data_str) if isinstance(data_str, str) else data_str
            except json.JSONDecodeError:
                logger.warning("Failed to parse Coordinator frame data: %s", data_str[:200])
                continue

            should_break = False
            for ev in self._process_coordinator_frame(sm, event_type, data):
                if ev is _STREAM_STOP_SENTINEL:
                    should_break = True
                    break
                yield ev
            if should_break:
                break

        if sm.has_error:
            self._sync_state_machine(sm)
            return

        for ev in sm.emit_closing():
            yield ev

        self._sync_state_machine(sm)

    @property
    def trace_id(self) -> str:
        return self._trace_id

    @property
    def message_id(self) -> str:
        return self._message_id

    @property
    def tool_call_records(self) -> List[ToolCallRecord]:
        return self._tool_call_records

    @property
    def collected_text(self) -> str:
        """流式过程中收集到的完整文本响应。"""
        return getattr(self, "_collected_text", "")

    async def transform_streaming_events(
        self,
        coordinator_stream: AsyncGenerator[Dict[str, Any], None],
    ) -> AsyncGenerator[Dict[str, str], None]:
        """
        流式转换：逐帧消费 SSE 帧输出，实时产出兼容
        sse_starlette EventSourceResponse 的 dict 格式事件。

        P2-12.2.5: 使用 AGUIStateMachine 统一状态管理，与 transform_streaming
        共享 _process_coordinator_frame 逻辑，仅输出格式不同。

        与 transform_streaming() 的区别：
        - transform_streaming() 产出原始 SSE 字符串 (data: {...}\\n\\n)
        - transform_streaming_events() 产出 {"data": "..."} dict，直接用于 EventSourceResponse
        """
        if not self._trace_id:
            self._trace_id = str(uuid.uuid4())
        self._message_id = str(uuid.uuid4())

        sm = AGUIStateMachine(self._trace_id, self._message_id, "dict")

        yield sm.emit_run_started()

        async for frame in coordinator_stream:
            event_type = frame.get("event", "")
            data_str = frame.get("data", "{}")

            try:
                data = json.loads(data_str) if isinstance(data_str, str) else data_str
            except json.JSONDecodeError:
                logger.warning("Failed to parse Coordinator frame data: %s", data_str[:200])
                continue

            should_break = False
            for ev in self._process_coordinator_frame(sm, event_type, data):
                if ev is _STREAM_STOP_SENTINEL:
                    should_break = True
                    break
                yield ev
            if should_break:
                break

        if sm.has_error:
            self._sync_state_machine(sm)
            return

        for ev in sm.emit_closing():
            yield ev

        self._sync_state_machine(sm)

    def _sync_state_machine(self, sm: AGUIStateMachine) -> None:
        """将状态机的状态同步回 adapter 实例属性。"""
        self._tool_call_records = sm.tool_call_records
        self._pending_tool_calls = sm.pending_tool_calls
        self._collected_text = sm.collected_text

    @staticmethod
    def _process_coordinator_frame(
        sm: AGUIStateMachine,
        event_type: str,
        data: Dict[str, Any],
    ) -> List[Any]:
        """P2-12.2.5: 处理 Coordinator SSE 帧，返回 AGUI 事件列表。

        统一 transform_streaming 和 transform_streaming_events 的帧处理逻辑。
        返回 _STREAM_STOP_SENTINEL 表示应停止迭代（错误或 done 事件）。

        Args:
            sm: AGUIStateMachine 实例
            event_type: 帧事件类型
            data: 帧数据

        Returns:
            AGUI 事件列表（可能包含 _STREAM_STOP_SENTINEL）
        """
        if event_type == "status":
            phase = data.get("phase", "")
            return [sm.emit_state_delta(phase=phase)]

        if event_type == "reasoning_iteration":
            return [sm.emit_state_delta(
                iteration=data.get("index", 0),
                maxIterations=data.get("max", 3),
            )]

        if event_type == "thinking":
            content = data.get("content", "")
            return sm.emit_thinking(content)

        if event_type == "tool_call_start":
            tool_id = data.get("id", str(uuid.uuid4()))
            tool_name = data.get("name", "unknown")
            args_str = data.get("arguments", "{}")
            return sm.emit_tool_call_start(tool_id, tool_name, args_str)

        if event_type == "tool_call_end":
            tool_id = data.get("id", "")
            end_ev = sm.emit_tool_call_end(tool_id)
            return [end_ev] if end_ev is not None else []

        if event_type == "tool_result":
            tool_id = data.get("id", "")
            tool_name = data.get("name", "")
            result_str = data.get("result", "{}")
            result_status = data.get("status", "unknown")
            return sm.emit_tool_result(tool_id, tool_name, result_str, result_status)

        if event_type == "error":
            error_code = data.get("error_code", "")
            error_message = data.get("message", "")
            return [sm.emit_run_error(error_code, error_message), _STREAM_STOP_SENTINEL]

        if event_type == "token":
            token = data.get("token", "")
            return sm.emit_token(token)

        if event_type == "done":
            raw_tool_results = data.get("tool_results", [])
            events = sm.emit_extra_tool_records(raw_tool_results)
            events.append(_STREAM_STOP_SENTINEL)
            return events

        return []

    # ============================================================
    # P1-1: LangGraph 输入源适配（新增方法）
    # ============================================================

    async def transform_langgraph_events(
        self,
        langgraph_stream: AsyncGenerator[Dict[str, Any], None],
    ) -> AsyncGenerator[Dict[str, str], None]:
        """消费 LangGraph stream 事件，产出 AG-UI dict 事件流（P1-1）。

        P2-12.2.5: 使用 AGUIStateMachine 统一状态管理。

        替代 transform_streaming_events() 的 Coordinator SSE 帧输入，
        改为消费 LangGraph EventBridge 输出的事件流。

        事件映射：
            - messages stream (AIMessageChunk) → TEXT_MESSAGE_CONTENT
            - thinking SSE 事件 → THINKING_START / THINKING_CONTENT
            - tool_call_start SSE 事件 → TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END
            - tool_result SSE 事件 → TOOL_CALL_RESULT
            - updates (response 节点) → 提取最终响应
            - values (error_code) → RUN_ERROR

        用法：
            bridge = LangGraphEventBridge(...)
            async for event in adapter.transform_langgraph_events(
                bridge.consume(graph.astream(...))
            ):
                yield event
        """
        if not self._trace_id:
            self._trace_id = str(uuid.uuid4())
        self._message_id = str(uuid.uuid4())

        sm = AGUIStateMachine(self._trace_id, self._message_id, "dict")
        final_response = ""

        yield sm.emit_run_started()

        async for event in langgraph_stream:
            event_type = event.get("type", "")
            should_stop = False

            for ev in self._process_langgraph_event(sm, event, event_type):
                if ev is _STREAM_STOP_SENTINEL:
                    should_stop = True
                    break
                # 跟踪 final_response（非流式回退）
                if final_response == "" and sm.response_text:
                    final_response = sm.response_text
                yield ev

            if should_stop:
                break

            # values 事件中提取 final_response
            if event_type == "values":
                data = event.get("data", {})
                if isinstance(data, dict):
                    resp = data.get("response", "")
                    if resp and not final_response and not sm.text_message_started:
                        final_response = resp

        if sm.has_error:
            self._sync_state_machine(sm)
            return

        # 结束事件
        thinking_end = sm.emit_thinking_end()
        if thinking_end is not None:
            yield thinking_end

        # 如果未通过 messages 流式输出，但有最终响应，则一次性输出
        if not sm.text_message_started and final_response:
            for ev in sm.emit_text_content(final_response):
                yield ev

        for ev in sm.emit_text_end():
            yield ev

        yield sm.emit_run_finished()

        self._sync_state_machine(sm)

    @staticmethod
    def _process_langgraph_event(
        sm: AGUIStateMachine,
        event: Dict[str, Any],
        event_type: str,
    ) -> List[Any]:
        """P2-12.2.5: 处理 LangGraph 事件，返回 AGUI 事件列表。

        统一 transform_langgraph_events 的事件处理逻辑。
        返回 _STREAM_STOP_SENTINEL 表示应停止迭代。

        Args:
            sm: AGUIStateMachine 实例
            event: LangGraph 事件字典
            event_type: 事件类型

        Returns:
            AGUI 事件列表（可能包含 _STREAM_STOP_SENTINEL）
        """
        # --- LangGraph 原生事件 ---

        if event_type == "messages":
            msg = event.get("event") or event.get("data", {})
            content = ""
            if hasattr(msg, "content"):
                content = msg.content or ""
            elif isinstance(msg, dict):
                content = msg.get("content", "")
            if content:
                return sm.emit_text_content(content)
            return []

        if event_type == "updates":
            node = event.get("node", "")
            data = event.get("data", {})
            events: List[Any] = []

            if not isinstance(data, dict):
                return []

            # response 节点：提取最终响应（非流式回退，不产出事件）
            if node == "response":
                # final_response 由调用方处理
                pass

            # agent 节点的 tool_calls
            if node == "agent":
                messages = data.get("messages", [])
                if messages:
                    last_msg = messages[-1]
                    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
                        for tc in last_msg.tool_calls:
                            tc_id = tc.get("id", str(uuid.uuid4()))
                            tc_name = tc.get("name", "unknown")
                            tc_args = json.dumps(
                                tc.get("args", tc.get("parameters", {})),
                                ensure_ascii=False,
                            )
                            events.extend(sm.emit_tool_call_start(tc_id, tc_name, tc_args))
                            # agent 节点的 tool_calls 立即结束（等待 tools 节点返回结果）
                            end_ev = sm.emit_tool_call_end(tc_id)
                            if end_ev is not None:
                                events.append(end_ev)

            # tools 节点：工具执行结果
            if node == "tools":
                messages = data.get("messages", [])
                for msg in messages:
                    if hasattr(msg, "type") and msg.type == "tool":
                        tool_call_id = getattr(msg, "tool_call_id", "")
                        tool_name = getattr(msg, "name", "unknown")
                        content = getattr(msg, "content", "")
                        events.extend(sm.emit_tool_result(
                            tool_call_id, tool_name, content, "success",
                        ))

            return events

        if event_type == "values":
            data = event.get("data", {})
            if isinstance(data, dict):
                error_code = data.get("error_code", "")
                if error_code:
                    return [
                        sm.emit_run_error(error_code, data.get("error_message", "")),
                        _STREAM_STOP_SENTINEL,
                    ]
            return []

        # --- SSE 细粒度事件（由 EventBridge 生成） ---

        if event_type == "thinking":
            # 仅触发 THINKING_START，内容由 messages 事件流式输出
            return sm.emit_thinking("")

        if event_type == "tool_call_start":
            tc_data = event.get("data", {})
            tc_id = tc_data.get("tool_call_id", str(uuid.uuid4()))
            tc_name = tc_data.get("tool_name", "unknown")
            return sm.emit_tool_call_start(tc_id, tc_name, "{}")

        if event_type == "tool_result":
            tc_data = event.get("data", {})
            tc_id = tc_data.get("tool_call_id", "")
            tc_name = tc_data.get("tool_name", "unknown")
            result_content = tc_data.get("result", "{}")
            return sm.emit_tool_result(tc_id, tc_name, result_content, "success")

        return []

    async def transform_langgraph(
        self,
        langgraph_stream: AsyncGenerator[Dict[str, Any], None],
    ) -> AsyncGenerator[str, None]:
        """消费 LangGraph stream 事件，产出 AG-UI SSE 字符串流（P1-1）。

        与 transform_langgraph_events() 的区别：
        - transform_langgraph_events() 产出 dict（用于 EventSourceResponse）
        - transform_langgraph() 产出原始 SSE 字符串（data: {...}\\n\\n）
        """
        async for event_dict in self.transform_langgraph_events(langgraph_stream):
            data = event_dict.get("data", "")
            yield f"data: {data}\n\n"


def encode_thinking_block(title: str, content: str) -> str:
    """
    为已有的完整思考内容生成 AG-UI 思考块事件序列。
    用于将 Coordinator 中的推理过程作为事后输出。
    """
    frames: List[str] = []
    if title:
        frames.append(AGUIEncoder.to_sse(
            AGUIEventType.THINKING_START, {"title": title},
        ))
    if content:
        chunk_size = 30
        for i in range(0, len(content), chunk_size):
            frames.append(AGUIEncoder.to_sse(
                AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT,
                {"delta": content[i:i + chunk_size]},
            ))
    frames.append(AGUIEncoder.to_sse(AGUIEventType.THINKING_END, {}))
    return "".join(frames)


@dataclass
class AGUIMessagesSnapshot:
    messages: List[Dict[str, Any]] = field(default_factory=list)

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.MESSAGES_SNAPSHOT,
            {"messages": self.messages},
        )