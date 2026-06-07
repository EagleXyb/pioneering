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


@dataclass
class RunFinishedEvent:
    thread_id: str = ""
    run_id: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
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


@dataclass
class TextMessageStartEvent:
    message_id: str = ""
    role: str = "assistant"

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
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


@dataclass
class TextMessageEndEvent:
    message_id: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
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


@dataclass
class ThinkingContentEvent:
    delta: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT,
            {"delta": self.delta},
        )


@dataclass
class ThinkingEndEvent:
    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(AGUIEventType.THINKING_END, {})


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


@dataclass
class ToolCallArgsEvent:
    tool_call_id: str = ""
    delta: str = ""

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
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


@dataclass
class ToolCallResultEvent:
    message_id: str = ""
    tool_call_id: str = ""
    tool_call_name: str = ""
    content: str = ""
    role: str = "tool"

    def to_sse(self) -> str:
        return AGUIEncoder.to_sse(
            AGUIEventType.TOOL_CALL_RESULT,
            {
                "messageId": self.message_id,
                "toolCallId": self.tool_call_id,
                "toolCallName": self.tool_call_name,
                "content": self.content,
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
        return f"data: {payload}\n\n"


class AGUIStreamAdapter:
    """
    将 ModuAgent Coordinator 的 stream_request() 输出转换为 AG-UI 标准 SSE 事件流。

    当前 Coordinator 的输出格式：
      frame = {"event": "token|error|done", "data": "<json_string>"}

    其中 done 事件的 data 格式：
      {"trace_id": "...", "tool_results": [{"tool": "name", "params": {...}, "result": {...}}, ...]}

    注意：tool_results 中每项的 tool/params/result 字段需要 Coordinator 在编码 done
    事件时显式提供。如果 Coordinator 仅输出原始 tool_result dict 列表（不含 tool/params），
    则适配器将跳过工具调用事件的生成。
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
        消费 Coordinator 的原始 SSE frame 流，产出 AG-UI 格式的 SSE 字符串流。

        用法：
            coordinator = Coordinator()
            adapter = AGUIStreamAdapter(trace_id="xxx")
            async for agui_frame in adapter.transform(
                coordinator.stream_request(user_id=..., session_id=..., input_data=...)
            ):
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
        流式转换：逐帧消费 Coordinator 输出，实时产出 AG-UI SSE 事件流。

        与 transform() 的区别：
        - transform() 先收集所有事件再一次性输出
        - transform_streaming() 边消费边输出，实现真正的实时流式体验
        """
        if not self._trace_id:
            self._trace_id = str(uuid.uuid4())
        self._message_id = str(uuid.uuid4())

        # 初始化状态
        has_error = False
        response_text = ""
        thinking_started = False
        text_message_started = False
        current_iteration = 0
        max_iterations = 3

        yield RunStartedEvent(
            thread_id=self._trace_id,
            run_id=self._trace_id,
        ).to_sse()

        async for frame in coordinator_stream:
            event_type = frame.get("event", "")
            data_str = frame.get("data", "{}")

            try:
                data = json.loads(data_str) if isinstance(data_str, str) else data_str
            except json.JSONDecodeError:
                logger.warning("Failed to parse Coordinator frame data: %s", data_str[:200])
                continue

            if event_type == "status":
                # 阶段切换 → 用于前端 Activity 面板状态更新
                phase = data.get("phase", "")
                yield AGUIEncoder.to_sse(
                    AGUIEventType.STATE_DELTA,
                    {"phase": phase, "traceId": self._trace_id},
                )

            elif event_type == "reasoning_iteration":
                current_iteration = data.get("index", 0)
                max_iterations = data.get("max", 3)
                yield AGUIEncoder.to_sse(
                    AGUIEventType.STATE_DELTA,
                    {
                        "iteration": current_iteration,
                        "maxIterations": max_iterations,
                        "traceId": self._trace_id,
                    },
                )

            elif event_type == "thinking":
                # 思考内容 → 流式输出 Thinking 事件
                content = data.get("content", "")
                if not thinking_started:
                    yield ThinkingStartEvent(title="深度思考").to_sse()
                    thinking_started = True

                # 分块输出思考内容
                chunk_size = 30
                for i in range(0, len(content), chunk_size):
                    yield ThinkingContentEvent(
                        delta=content[i:i + chunk_size],
                    ).to_sse()

            elif event_type == "tool_call_start":
                tool_id = data.get("id", str(uuid.uuid4()))
                tool_name = data.get("name", "unknown")
                args_str = data.get("arguments", "{}")
                self._pending_tool_calls[tool_id] = {
                    "tool_name": tool_name,
                    "arguments": args_str,
                }
                yield ToolCallStartEvent(
                    tool_call_id=tool_id,
                    tool_call_name=tool_name,
                    parent_message_id=self._message_id,
                ).to_sse()

                # 流式输出参数
                if args_str and args_str != "{}":
                    yield ToolCallArgsEvent(
                        tool_call_id=tool_id,
                        delta=args_str,
                    ).to_sse()

            elif event_type == "tool_call_end":
                tool_id = data.get("id", "")
                if tool_id in self._pending_tool_calls:
                    yield ToolCallEndEvent(tool_call_id=tool_id).to_sse()

            elif event_type == "tool_result":
                tool_id = data.get("id", "")
                tool_name = data.get("name", "")
                result_str = data.get("result", "{}")
                result_status = data.get("status", "unknown")

                if tool_id in self._pending_tool_calls:
                    tool_name = tool_name or self._pending_tool_calls[tool_id]["tool_name"]
                    params = json.loads(self._pending_tool_calls[tool_id].get("arguments", "{}"))
                    self._tool_call_records.append(ToolCallRecord(
                        tool_name=tool_name,
                        params=params,
                        result={"data": result_str, "status": result_status},
                    ))

                yield ToolCallResultEvent(
                    message_id=self._message_id,
                    tool_call_id=tool_id,
                    tool_call_name=tool_name,
                    content=result_str,
                ).to_sse()

            elif event_type == "error":
                has_error = True
                error_code = data.get("error_code", "")
                error_message = data.get("message", "")
                yield RunErrorEvent(code=error_code, message=error_message).to_sse()
                return

            elif event_type == "token":
                token = data.get("token", "")
                response_text += token
                if not text_message_started:
                    yield TextMessageStartEvent(
                        message_id=self._message_id,
                        role="assistant",
                    ).to_sse()
                    text_message_started = True
                yield TextMessageContentEvent(
                    message_id=self._message_id,
                    delta=token,
                ).to_sse()

            elif event_type == "done":
                # 处理 done 事件中附加的 tool_results
                raw_tool_results = data.get("tool_results", [])
                extra_records = self._parse_tool_records(raw_tool_results)
                existing_names = {r.tool_name for r in self._tool_call_records}
                for rec in extra_records:
                    if rec.tool_name not in existing_names:
                        self._tool_call_records.append(rec)
                        yield ToolCallStartEvent(
                            tool_call_id=str(uuid.uuid4()),
                            tool_call_name=rec.tool_name,
                            parent_message_id=self._message_id,
                        ).to_sse()
                        yield ToolCallEndEvent(
                            tool_call_id=str(uuid.uuid4()),
                        ).to_sse()
                        yield ToolCallResultEvent(
                            message_id=self._message_id,
                            tool_call_id=str(uuid.uuid4()),
                            tool_call_name=rec.tool_name,
                            content=json.dumps(rec.result, ensure_ascii=False),
                        ).to_sse()
                break

        if has_error:
            return

        # 结束思考块
        if thinking_started:
            yield ThinkingEndEvent().to_sse()

        # 结束文本消息
        if text_message_started:
            yield TextMessageEndEvent(message_id=self._message_id).to_sse()
        elif response_text:
            # 如果思考过程中包含了回答但未启动 text message
            yield TextMessageStartEvent(
                message_id=self._message_id,
                role="assistant",
            ).to_sse()
            yield TextMessageContentEvent(
                message_id=self._message_id,
                delta=response_text,
            ).to_sse()
            yield TextMessageEndEvent(message_id=self._message_id).to_sse()

        yield RunFinishedEvent(
            thread_id=self._trace_id,
            run_id=self._trace_id,
        ).to_sse()

    @property
    def trace_id(self) -> str:
        return self._trace_id

    @property
    def message_id(self) -> str:
        return self._message_id

    @property
    def tool_call_records(self) -> List[ToolCallRecord]:
        return self._tool_call_records


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