from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

from app.config import settings

logger = logging.getLogger(__name__)

_registered = False

_MODUAGENT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "ModuAgent")


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

                yield {"data": json.dumps(event, ensure_ascii=False)}
    except Exception as e:
        logger.error("Agent stream error: %s", str(e))
        error_event = {"type": "error", "errorCode": "AGENT_ERROR", "message": str(e)}
        yield {"data": json.dumps(error_event, ensure_ascii=False)}

    metadata = {
        "thinkingContent": thinking_content,
        "answerContent": answer_content,
        "toolCalls": tool_calls,
        "toolResults": tool_results_data,
        "hasError": has_error,
        "errorInfo": error_info,
    }

    yield {"data": json.dumps({"type": "__metadata__", "payload": metadata}, ensure_ascii=False)}


async def stream_agent_completion(
    message: str,
    session_id: str,
    user_id: str,
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> AsyncGenerator[str, None]:
    """Agent ReAct 流式对话，SSE 事件对齐 API YAML 规范。

    事件类型: thinking / tool_call / tool_result / text / done / error
    最后一条 done 事件包含 metadata (用于 DB 持久化):
      { type: "done", contentBlocks, promptTokens, completionTokens, latencyMs,
        toolExecutions: [{executionId, toolName, inputParams, outputResult, outputSummary, status, startTime, endTime, durationMs}] }
    """
    import time as _time

    _init_moduagent()

    from core.registry import get_registry
    from orchestration.coordinator import Coordinator

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

    content_blocks: List[Dict[str, Any]] = []
    tool_executions: List[Dict[str, Any]] = []
    full_text = ""
    has_error = False
    error_info: Dict[str, str] = {}
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0}
    start_time = _time.time()

    # 当前正在构建的 content block
    current_thinking: Optional[Dict[str, Any]] = None
    current_text_stream: Optional[Dict[str, Any]] = None

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

            # --- thinking 事件 ---
            if event_type == "thinking":
                content = data.get("content", "")
                if not content:
                    continue
                current_thinking = {
                    "type": "thinking",
                    "status": "success",
                    "summary": content[:200] + ("..." if len(content) > 200 else ""),
                }
                content_blocks.append(current_thinking)
                yield _agent_sse("thinking", current_thinking)

            # --- reasoning_iteration (忽略，融入 thinking) ---
            elif event_type == "reasoning_iteration":
                pass

            # --- status 事件 (perception/memory/thinking 等状态) ---
            elif event_type == "status":
                phase = data.get("phase", "")
                if phase == "thinking":
                    pass  # 忽略内部阶段标记
                elif phase in ("perception", "memory"):
                    pass

            # --- tool_call_start ---
            elif event_type == "tool_call_start":
                block = {
                    "type": "tool_call",
                    "status": "running",
                    "toolName": data.get("name", ""),
                    "executionId": data.get("id", ""),
                    "summary": f"调用工具 {data.get('name', '')}",
                }
                content_blocks.append(block)
                yield _agent_sse("tool_call", block)

            # --- tool_call_end (忽略) ---
            elif event_type == "tool_call_end":
                pass

            # --- tool_result ---
            elif event_type == "tool_result":
                exec_id = data.get("id", "")
                tool_name = data.get("name", "")
                result_str = data.get("result", "{}")
                status_str = data.get("status", "unknown")
                # 查找 tool_results 中的详细信息
                tool_detail = {}
                for tr in data.get("_tool_results", []):
                    if tr.get("execution_id") == exec_id:
                        tool_detail = tr
                        break

                # 更新之前的 tool_call block 状态
                for b in reversed(content_blocks):
                    if b.get("type") == "tool_call" and b.get("executionId") == exec_id:
                        b["status"] = "success" if status_str == "success" else "error"
                        break

                block_result = {
                    "type": "tool_result",
                    "status": "success" if status_str == "success" else "error",
                    "toolName": tool_name,
                    "executionId": exec_id,
                    "summary": result_str[:200] if result_str else "",
                }
                content_blocks.append(block_result)
                yield _agent_sse("tool_result", block_result)

            # --- token (流式文本) ---
            elif event_type == "token":
                token = data.get("token", "")
                if not token:
                    continue
                if current_text_stream is None or current_text_stream.get("type") != "text_stream":
                    current_text_stream = {"type": "text_stream", "status": "running", "text": ""}
                    content_blocks.append(current_text_stream)
                current_text_stream["text"] = (current_text_stream.get("text", "") or "") + token
                full_text += token
                yield _agent_sse("text", {"type": "text_stream", "text": token})

            # --- done ---
            elif event_type == "done":
                if "usage" in data:
                    total_usage["prompt_tokens"] = data["usage"].get("prompt_tokens", 0)
                    total_usage["completion_tokens"] = data["usage"].get("completion_tokens", 0)

                # 提取工具执行明细
                for tr in data.get("tool_results", []):
                    tool_executions.append({
                        "executionId": tr.get("execution_id", ""),
                        "toolName": tr.get("tool", ""),
                        "toolCallId": "",
                        "inputParams": tr.get("input_params", {}),
                        "outputResult": json.dumps(tr.get("data", {}), ensure_ascii=False) if tr.get("data") else "",
                        "outputSummary": json.dumps(tr.get("data", {}), ensure_ascii=False)[:500] if tr.get("data") else "",
                        "status": tr.get("status", "unknown"),
                        "errorMessage": tr.get("error_code", ""),
                        "startTime": tr.get("start_time", ""),
                        "endTime": tr.get("end_time", ""),
                        "durationMs": tr.get("duration_ms", 0),
                    })

                # 标记 text_stream 完成
                if current_text_stream:
                    current_text_stream["status"] = "success"

                latency_ms = int((_time.time() - start_time) * 1000)
                yield _agent_sse("done", {})

            # --- error ---
            elif event_type == "error":
                has_error = True
                error_info = {"code": data.get("error_code", "UNKNOWN"), "message": data.get("message", "")}
                yield _agent_sse("error", error_info)

    except Exception as e:
        logger.error("Agent stream error: %s", str(e))
        has_error = True
        error_info = {"code": "AGENT_ERROR", "message": str(e)}
        yield _agent_sse("error", error_info)

    # 延迟到 done 之后的 metadata（作为最后一条 SSE 消息，前端可据此持久化）
    latency_ms = int((_time.time() - start_time) * 1000)
    metadata = {
        "type": "__agent_metadata__",
        "contentBlocks": content_blocks,
        "answerContent": full_text,
        "promptTokens": total_usage.get("prompt_tokens", 0),
        "completionTokens": total_usage.get("completion_tokens", 0),
        "latencyMs": latency_ms,
        "toolExecutions": tool_executions,
        "hasError": has_error,
        "errorInfo": error_info,
    }
    yield {"data": json.dumps(metadata, ensure_ascii=False)}


def _agent_sse(event: str, data: dict) -> dict:
    """生成 Agent API 标准 SSE 格式"""
    return {"data": json.dumps(data, ensure_ascii=False)}