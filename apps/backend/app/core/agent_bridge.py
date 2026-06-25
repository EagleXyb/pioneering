from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Dict, List, Optional

from app.config import settings

logger = logging.getLogger(__name__)

_registered = False

_MODUAGENT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "ModuAgent")


# ========== StreamContext: 元数据收集 ==========


@dataclass
class StreamContext:
    """在流式传输过程中收集元数据，供 DB 持久化使用。"""

    answer_content: str = ""
    content_blocks: List[Dict[str, Any]] = field(default_factory=list)
    tool_executions: List[Dict[str, Any]] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    has_error: bool = False
    error_info: Dict[str, str] = field(default_factory=dict)
    start_time: float = field(default_factory=time.time)

    def finish(self) -> None:
        self.latency_ms = int((time.time() - self.start_time) * 1000)


# ========== ModuAgent 初始化 ==========


def _init_moduagent() -> None:
    global _registered
    if _registered:
        return

    if _MODUAGENT_DIR not in sys.path:
        sys.path.insert(0, _MODUAGENT_DIR)

    from components.action.executors.synchronous import SyncActionExecutor
    from components.action.tools.calculator import CalculatorTool
    from components.action.tools.search import SearchTool
    from components.memory.cache.redis_adapter import InMemoryShortTermMemory
    from components.memory.vector.chroma import ChromaLongTermMemory
    from components.perception.text.rule_based import TextPreprocessor
    from components.reasoning.llm.base_llm import BaseLLMReasoner
    from core.registry import get_registry

    registry = get_registry()

    engine_name = "default"
    registry.register_reasoning_engine(
        engine_name,
        BaseLLMReasoner(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            default_model=settings.llm_default_model,
        ),
    )

    registry.register_perception("text_preprocessor", TextPreprocessor())
    registry.register_memory("short_term", InMemoryShortTermMemory())
    registry.register_memory("long_term", ChromaLongTermMemory())
    registry.register_tool(CalculatorTool())
    registry.register_tool(SearchTool())
    registry.register_action_executor("sync", SyncActionExecutor())

    _registered = True
    logger.info("ModuAgent components initialized with model=%s", settings.llm_default_model)


# ========== AG-UI 流式 Agent 对话 ==========


async def stream_agent_completion(
    message: str,
    session_id: str,
    user_id: str,
    ctx: StreamContext,
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
    history: Optional[List[Dict[str, str]]] = None,
) -> AsyncGenerator[Dict[str, str], None]:
    """Agent ReAct 流式对话，输出 AG-UI 标准 SSE 事件。

    通过 AGUIStreamAdapter 将 Coordinator 帧转换为 AG-UI 协议事件，
    产出兼容 sse_starlette EventSourceResponse 的 {"data": "..."} dict。

    Args:
        message: 用户输入消息
        session_id: 会话 ID
        user_id: 用户 ID
        ctx: StreamContext 元数据收集器，流结束后由调用方读取
        model: 可选模型覆盖
        system_prompt: 可选系统提示词覆盖
        history: 可选会话历史消息列表
    """
    _init_moduagent()

    from core.registry import get_registry
    from orchestration.coordinator import Coordinator
    from orchestration.communication.agui_adapter import AGUIStreamAdapter

    registry = get_registry()

    if model and model != settings.llm_default_model:
        from components.reasoning.llm.base_llm import BaseLLMReasoner
        registry.register_reasoning_engine(
            "agent_dynamic",
            BaseLLMReasoner(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url,
                default_model=model,
                system_prompt=system_prompt,
            ),
        )
        from adapters.llm_adapter import LLMAdapter
        dynamic_adapter = LLMAdapter(engine_name="agent_dynamic")
    else:
        dynamic_adapter = None

    coordinator = Coordinator()
    if dynamic_adapter:
        coordinator._llm_adapter = dynamic_adapter

    # 注入会话历史到 input_data
    input_data: Dict[str, Any] = {"input_type": "text", "prompt": message}
    if history:
        input_data["history"] = history

    trace_id = str(uuid.uuid4())
    adapter = AGUIStreamAdapter(trace_id=trace_id)

    try:
        async for event_dict in adapter.transform_streaming_events(
            coordinator.stream_request(
                user_id=user_id,
                session_id=session_id,
                input_data=input_data,
                trace_id=trace_id,
            )
        ):
            yield event_dict

            # 收集元数据
            _collect_metadata_from_event(event_dict, ctx)

    except Exception as e:
        logger.error("Agent stream error: %s", str(e))
        ctx.has_error = True
        ctx.error_info = {"code": "AGENT_ERROR", "message": str(e)}
        from orchestration.communication.agui_adapter import AGUIEncoder, AGUIEventType
        yield AGUIEncoder.to_event_dict(
            AGUIEventType.RUN_ERROR,
            {"code": "AGENT_ERROR", "message": str(e)},
        )

    # 流结束，填充元数据
    ctx.answer_content = adapter.collected_text
    ctx.finish()

    # 从 adapter 的 tool_call_records 构建 tool_executions
    for rec in adapter.tool_call_records:
        ctx.tool_executions.append({
            "executionId": str(uuid.uuid4()),
            "toolName": rec.tool_name,
            "inputParams": rec.params,
            "outputResult": json.dumps(rec.result, ensure_ascii=False),
            "outputSummary": json.dumps(rec.result, ensure_ascii=False)[:500],
            "status": rec.result.get("status", "unknown"),
        })


def _collect_metadata_from_event(event_dict: Dict[str, str], ctx: StreamContext) -> None:
    """从 AG-UI 事件中提取元数据，填充 StreamContext。"""
    data_str = event_dict.get("data", "")
    if not data_str:
        return
    try:
        data = json.loads(data_str)
    except (json.JSONDecodeError, TypeError):
        return

    event_type = data.get("type", "")

    if event_type == "THINKING_START":
        ctx.content_blocks.append({"type": "thinking", "status": "running", "summary": ""})
    elif event_type == "THINKING_TEXT_MESSAGE_CONTENT":
        for b in ctx.content_blocks:
            if b.get("type") == "thinking" and b.get("status") == "running":
                b["summary"] += data.get("delta", "")
                break
    elif event_type == "THINKING_END":
        for b in ctx.content_blocks:
            if b.get("type") == "thinking" and b.get("status") == "running":
                b["status"] = "success"
                break
    elif event_type == "TOOL_CALL_START":
        ctx.content_blocks.append({
            "type": "tool_call",
            "status": "running",
            "toolName": data.get("toolCallName", ""),
            "executionId": data.get("toolCallId", ""),
        })
    elif event_type == "TOOL_CALL_RESULT":
        for b in reversed(ctx.content_blocks):
            if b.get("type") == "tool_call" and b.get("executionId") == data.get("toolCallId"):
                b["status"] = "success"
                break
        ctx.content_blocks.append({
            "type": "tool_result",
            "status": "success",
            "toolName": data.get("toolCallName", ""),
            "executionId": data.get("toolCallId", ""),
            "summary": data.get("content", "")[:200],
        })
    elif event_type == "TEXT_MESSAGE_CONTENT":
        if not any(b.get("type") == "text_stream" for b in ctx.content_blocks):
            ctx.content_blocks.append({"type": "text_stream", "status": "running", "text": ""})
        for b in ctx.content_blocks:
            if b.get("type") == "text_stream" and b.get("status") == "running":
                b["text"] += data.get("delta", "")
                break
    elif event_type == "TEXT_MESSAGE_END":
        for b in ctx.content_blocks:
            if b.get("type") == "text_stream" and b.get("status") == "running":
                b["status"] = "success"
                break
    elif event_type == "RUN_ERROR":
        ctx.has_error = True
        ctx.error_info = {"code": data.get("code", ""), "message": data.get("message", "")}


# ========== 兼容旧接口（chat 路由） ==========


async def stream_chat_completion(
    message: str,
    session_id: str,
    user_id: str,
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> AsyncGenerator[str, None]:
    """简单对话流式输出（非 Agent ReAct 模式），保留旧接口兼容。"""
    _init_moduagent()

    from core.registry import get_registry
    from orchestration.coordinator import Coordinator

    registry = get_registry()

    if model and model != settings.llm_default_model:
        from components.reasoning.llm.base_llm import BaseLLMReasoner
        registry.register_reasoning_engine(
            "dynamic",
            BaseLLMReasoner(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url,
                default_model=model,
                system_prompt=system_prompt,
            ),
        )
        from adapters.llm_adapter import LLMAdapter
        dynamic_adapter = LLMAdapter(engine_name="dynamic")
    else:
        dynamic_adapter = None

    coordinator = Coordinator()
    if dynamic_adapter:
        coordinator._llm_adapter = dynamic_adapter

    try:
        async for frame in coordinator.stream_request(
            user_id=user_id,
            session_id=session_id,
            input_data={"input_type": "text", "prompt": message},
        ):
            event_type = frame.get("event", "")
            data_str = frame.get("data", "{}")

            try:
                data = json.loads(data_str) if isinstance(data_str, str) else data_str
            except json.JSONDecodeError:
                continue

            if event_type == "token":
                yield {"data": json.dumps({"type": "text", "text": data.get("token", "")}, ensure_ascii=False)}
            elif event_type == "error":
                yield {"data": json.dumps({"type": "error", "code": data.get("error_code", ""), "message": data.get("message", "")}, ensure_ascii=False)}
            elif event_type == "done":
                yield {"data": json.dumps({"type": "done"}, ensure_ascii=False)}
    except Exception as e:
        logger.error("Chat stream error: %s", str(e))
        yield {"data": json.dumps({"type": "error", "code": "CHAT_ERROR", "message": str(e)}, ensure_ascii=False)}
