from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

from app.config import settings

logger = logging.getLogger(__name__)

_registered = False


def _init_moduagent() -> None:
    global _registered
    if _registered:
        return

    from components.action.executors.synchronous import SyncActionExecutor
    from components.action.tools.calculator import CalculatorTool
    from components.action.tools.search import SearchTool
    from components.memory.cache.redis_adapter import InMemoryShortTermMemory
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
    registry.register_tool(CalculatorTool())
    registry.register_tool(SearchTool())
    registry.register_action_executor("sync", SyncActionExecutor())

    _registered = True
    logger.info("ModuAgent components initialized with model=%s", settings.llm_default_model)


def _coordinator_frame_to_frontend_event(
    frame: Dict[str, Any],
    step_id: str,
) -> Optional[List[Dict[str, Any]]]:
    event_type = frame.get("event", "")
    data_str = frame.get("data", "{}")

    try:
        data = json.loads(data_str) if isinstance(data_str, str) else data_str
    except json.JSONDecodeError:
        logger.warning("Failed to parse frame data: %s", data_str[:200])
        return None

    if event_type == "status":
        phase = data.get("phase", "")
        if phase in ("perception", "memory"):
            return None
        return [{"type": "status", "status": phase}]

    elif event_type == "thinking":
        content = data.get("content", "")
        if not content:
            return None
        return [
            {"type": "thinking_delta", "stepId": step_id, "content": content},
            {"type": "thinking_done", "stepId": step_id},
        ]

    elif event_type == "reasoning_iteration":
        return [{
            "type": "reasoning_iteration",
            "iterationIndex": data.get("index", 1),
            "maxIterations": data.get("max", 3),
        }]

    elif event_type == "tool_call_start":
        return [{
            "type": "tool_call_start",
            "id": data.get("id", ""),
            "name": data.get("name", ""),
            "arguments": data.get("arguments", "{}"),
        }]

    elif event_type == "tool_call_end":
        return [{
            "type": "tool_call_end",
            "id": data.get("id", ""),
            "name": data.get("name", ""),
            "arguments": data.get("arguments", "{}"),
        }]

    elif event_type == "tool_result":
        return [{
            "type": "tool_result_end",
            "id": data.get("id", ""),
            "name": data.get("name", ""),
            "result": data.get("result", "{}"),
            "status": data.get("status", "unknown"),
        }]

    elif event_type == "token":
        return [{
            "type": "answer_delta",
            "stepId": step_id,
            "content": data.get("token", ""),
        }]

    elif event_type == "error":
        return [{
            "type": "error",
            "errorCode": data.get("error_code", "UNKNOWN"),
            "message": data.get("message", ""),
        }]

    elif event_type == "done":
        return [{"type": "answer_done", "stepId": step_id}]

    return None


async def stream_chat_completion(
    message: str,
    session_id: str,
    user_id: str,
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> AsyncGenerator[str, None]:
    _init_moduagent()

    from core.registry import get_registry
    from components.reasoning.llm.base_llm import BaseLLMReasoner
    from orchestration.coordinator import Coordinator

    registry = get_registry()

    if model and model != settings.llm_default_model:
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

    step_id = str(uuid.uuid4())
    full_response = ""
    thinking_content = ""
    answer_content = ""
    tool_calls: List[Dict[str, Any]] = []
    tool_results_data: List[Dict[str, Any]] = []
    has_error = False
    error_info: Dict[str, str] = {}
    current_tool_calls: Dict[str, Dict[str, Any]] = {}

    try:
        async for frame in coordinator.stream_request(
            user_id=user_id,
            session_id=session_id,
            input_data={"input_type": "text", "prompt": message},
        ):
            events = _coordinator_frame_to_frontend_event(frame, step_id)
            if events is None:
                continue

            for event in events:
                etype = event.get("type", "")

                if etype == "thinking_delta":
                    thinking_content = event.get("content", "")
                elif etype == "answer_delta":
                    answer_content += event.get("content", "")
                    full_response += event.get("content", "")
                elif etype == "tool_call_start":
                    current_tool_calls[event.get("id", "")] = {
                        "name": event.get("name", ""),
                        "arguments": event.get("arguments", "{}"),
                    }
                elif etype == "tool_call_end":
                    pass
                elif etype == "tool_result_end":
                    tid = event.get("id", "")
                    tc_info = current_tool_calls.get(tid, {})
                    tool_calls.append({
                        "id": tid,
                        "name": event.get("name", tc_info.get("name", "")),
                        "arguments": tc_info.get("arguments", "{}"),
                    })
                    tool_results_data.append({
                        "id": tid,
                        "name": event.get("name", tc_info.get("name", "")),
                        "result": event.get("result", "{}"),
                        "status": event.get("status", "unknown"),
                    })
                elif etype == "error":
                    has_error = True
                    error_info = {"errorCode": event.get("errorCode", ""), "message": event.get("message", "")}

                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
    except Exception as e:
        logger.error("Agent stream error: %s", str(e))
        error_event = {"type": "error", "errorCode": "AGENT_ERROR", "message": str(e)}
        yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"

    metadata = {
        "thinkingContent": thinking_content,
        "answerContent": answer_content,
        "toolCalls": tool_calls,
        "toolResults": tool_results_data,
        "hasError": has_error,
        "errorInfo": error_info,
    }

    yield f"data: {json.dumps({'type': '__metadata__', 'payload': metadata}, ensure_ascii=False)}\n\n"