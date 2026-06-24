from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from adapters.llm_adapter import LLMAdapter
from adapters.storage_adapter import StorageAdapter
from adapters.tool_adapter import ToolAdapter
from components.perception import build_perception_event_metadata, extract_perception_context
from components.perception.fusion import PerceptionFusion
from config.runtime_config import get_config
from core.interfaces.perception import BaseSensor
from core.registry import get_registry
from orchestration.communication.message_bus import (
    EvolutionSignalCollector,
    PersistentEventLog,
    get_event_bus,
)
from orchestration.communication.protocol import (
    AgentEvent,
    EventAction,
    EventDomain,
    ErrorCode,
)
from orchestration.communication.streaming import SSEEncoder, StreamPublisher

logger = logging.getLogger(__name__)


class Coordinator:
    def __init__(self):
        self._llm_adapter = LLMAdapter()
        self._storage_adapter = StorageAdapter()
        self._tool_adapter = ToolAdapter()
        self._event_bus = get_event_bus()
        self._registry = get_registry()
        # 感知融合器（对应问题 9）
        self._fusion = PerceptionFusion(
            strategy=get_config().get("perception.fusion.strategy", "weighted_average"),
            weights=get_config().get("perception.fusion.weights"),
        )
        # Sensor 生命周期管理（对应问题 8）
        self._sensor_tasks: Dict[str, asyncio.Task] = {}
        # P1: 事件日志持久化 + 进化信号收集
        self._persistent_log: Optional[PersistentEventLog] = None
        self._evolution_collector: Optional[EvolutionSignalCollector] = None
        self._init_persistence(get_config())

    def _init_persistence(self, config) -> None:
        """初始化事件日志持久化和进化信号收集器。"""
        # P1: 事件日志持久化
        log_path = config.get("perception.event_log_path", "logs/perception_events.jsonl")
        if log_path:
            self._persistent_log = PersistentEventLog(
                log_file_path=log_path,
                max_file_size_mb=config.get("perception.event_log_max_size_mb", 10.0),
            )

        # P1: 进化信号收集器
        self._evolution_collector = EvolutionSignalCollector(
            report_interval=config.get("perception.evolution_report_interval", 100),
        )

    async def start_persistence(self) -> None:
        """启动事件持久化和进化信号收集（需在异步上下文中调用）。"""
        if self._persistent_log:
            await self._persistent_log.start(self._event_bus)
        if self._evolution_collector:
            self._event_bus.subscribe(self._evolution_collector.on_perception_event)

    async def stop_persistence(self) -> None:
        """停止事件持久化。"""
        if self._persistent_log:
            await self._persistent_log.stop()

    def get_evolution_signals(self) -> Dict[str, Any]:
        """获取当前进化信号摘要。"""
        if self._evolution_collector:
            return self._evolution_collector.get_signals()
        return {}

    async def process_request(
        self,
        user_id: str,
        session_id: str,
        input_data: Dict[str, Any],
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        import uuid

        if not trace_id:
            trace_id = str(uuid.uuid4())

        context = {
            "trace_id": trace_id,
            "session_id": session_id,
            "user_id": user_id,
        }

        config = get_config()

        # 感知层：输入类型路由 + 感知器链（对应问题 9）
        perception_result = self._run_perception_pipeline(input_data, config)

        detected_level = 0
        if perception_result:
            detected_level = perception_result.get("metadata", {}).get("sensitivity_level", 0)

            sensitivity_threshold = config.get("perception.sensitivity_threshold", 5)
            if detected_level >= sensitivity_threshold:
                logger.warning(
                    "Sensitivity circuit breaker triggered: trace_id=%s level=%d",
                    trace_id,
                    detected_level,
                )
                return {
                    "status": "error",
                    "error_code": ErrorCode.PERCEPTION_SENSITIVITY_REJECTED,
                    "data": {"message": "Input rejected due to sensitive content"},
                }

            # 安全检测熔断（对应问题 5）
            security_config = config.get("perception.security", {})
            if security_config.get("block_on_injection") and perception_result.get("metadata", {}).get("injection_detected"):
                return {
                    "status": "error",
                    "error_code": ErrorCode.PERCEPTION_SENSITIVITY_REJECTED,
                    "data": {"message": "Input rejected due to prompt injection detected"},
                }

        cleaned_text = None
        if perception_result and perception_result.get("parsed_content"):
            cleaned_text = perception_result["parsed_content"].get("text")

        # 感知结果注入 LLM Context（对应问题 7）
        if perception_result:
            context["perception"] = extract_perception_context(perception_result)
            # 低置信度 → 保守模式（降低 temperature）
            confidence = perception_result.get("confidence", 1.0)
            if confidence < 0.5:
                logger.info("Low confidence (%.2f), switching to conservative mode", confidence)

        # 感知事件：标准化 metadata（对应问题 11）
        perception_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.PERCEPTION,
            action=EventAction.ANALYZE,
            metadata=build_perception_event_metadata(
                perception_result or {}, input_data.get("input_type", "text")
            ) if perception_result else {
                "input_type": input_data.get("input_type", "text"),
                "sensitivity_level": "0",
                "truncated": "False",
            },
        )
        await self._event_bus.publish(perception_event)

        prompt = cleaned_text if cleaned_text is not None else input_data.get("prompt", "")

        memory_result = self._storage_adapter.query_all(
            user_id=user_id,
            context_window=config.get("memory.context_window", "last_5_turns"),
            required_fields=input_data.get("required_fields", ["user_intent"]),
            query_text=prompt,
        )

        memory_data = memory_result.get("data", {})
        context["history"] = memory_data.get("history", [])
        context["knowledge"] = memory_data.get("knowledge", [])

        context_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.MEMORY,
            action=EventAction.QUERY,
            metadata={
                "has_history": str(len(memory_data.get("history", [])) > 0),
                "has_knowledge": str(len(memory_data.get("knowledge", [])) > 0),
                "memory_status": memory_result.get("status", "unknown"),
            },
        )
        await self._event_bus.publish(context_event)

        if not prompt:
            return {"status": "error", "error_code": "INPUT_001", "data": {"message": "prompt is required"}}

        prompt_template = config.get("llm.prompt_template", "")
        if prompt_template:
            prompt = prompt_template.replace("{input}", prompt)

        native_tools = self._build_native_tools()
        context["native_tools"] = native_tools

        if native_tools:
            context["tool_descriptions"] = ""
        else:
            tool_descriptions = self._build_tool_descriptions()
            context["tool_descriptions"] = tool_descriptions

        reasoning_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.REASONING,
            action=EventAction.GENERATE,
            metadata={
                "has_tools": str(bool(native_tools or context.get("tool_descriptions"))),
                "template_used": str(bool(prompt_template)),
            },
        )
        await self._event_bus.publish(reasoning_event)

        tool_results: List[Dict[str, Any]] = []
        total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        max_iterations = config.get("llm.max_reasoning_iterations", 3)
        max_format_retries = config.get("llm.max_format_retries", 2)
        tool_call_pattern = config.get("llm.tool_call_pattern", r"```tool_call\s*\n(.*?)\n```")

        # 保守模式：低置信度时降低 temperature（对应问题 7）
        effective_temperature = config.get("llm.temperature", 0.7)
        if perception_result and perception_result.get("confidence", 1.0) < 0.5:
            effective_temperature = min(effective_temperature, 0.3)

        try:
            response, _llm_usage, native_tool_calls = self._llm_adapter.generate(
                prompt=prompt,
                context=context,
                temperature=effective_temperature,
                max_tokens=config.get("llm.max_tokens", 512),
            )
            total_usage["prompt_tokens"] += _llm_usage.get("prompt_tokens", 0)
            total_usage["completion_tokens"] += _llm_usage.get("completion_tokens", 0)
            total_usage["total_tokens"] += _llm_usage.get("total_tokens", 0)
        except Exception as e:
            logger.error("LLM generation failed: %s", str(e))
            return {"status": "error", "error_code": "LLM_001", "data": {"message": str(e)}}

        format_retries = 0
        for iteration in range(max_iterations):
            if native_tool_calls:
                tool_calls = native_tool_calls
                parse_errors = []
            else:
                tool_calls, parse_errors = self._parse_tool_calls_with_errors(response, tool_call_pattern)

            if not tool_calls and not parse_errors:
                break

            if not tool_calls and parse_errors:
                if format_retries < max_format_retries:
                    error_feedback = "\n".join(
                        f"Invalid tool call: {e['raw']}\nError: {e['error']}"
                        for e in parse_errors
                    )
                    context.setdefault("history", []).extend([
                        {"role": "assistant", "content": response},
                        {"role": "user", "content": (
                            f"[Format Error]\n{error_feedback}\n\n"
                            "Please correct your tool call format. Use:\n"
                            '```tool_call\n{"tool": "<tool_name>", "parameters": {<params>}}\n```'
                        )},
                    ])
                    try:
                        response, _, native_tool_calls = self._llm_adapter.generate(
                            prompt="Please correct your tool call format and try again.",
                            context=context,
                            temperature=config.get("llm.temperature", 0.7),
                            max_tokens=config.get("llm.max_tokens", 512),
                        )
                        format_retries += 1
                        continue
                    except Exception as e:
                        logger.error("LLM self-correction failed: %s", str(e))
                        break
                else:
                    logger.warning(
                        "Max format retries (%d) reached, treating as final response",
                        max_format_retries,
                    )
                    break

            iteration_results: List[Dict[str, Any]] = []
            for tool_call in tool_calls:
                tool_name = tool_call.get("tool", "")
                tool_params = tool_call.get("parameters", {})
                if not tool_name:
                    logger.warning("Tool call missing 'tool' field, skipping")
                    continue

                tool_result = self._tool_adapter.invoke_tool(
                    tool_name=tool_name,
                    params=tool_params,
                    context=context,
                    timeout_ms=config.get("tools.default_timeout_ms", 1800000),
                )
                iteration_results.append({"tool": tool_name, "result": tool_result})
                tool_results.append(tool_result)

                tool_call_event = AgentEvent(
                    trace_id=trace_id,
                    session_id=session_id,
                    user_id=user_id,
                    domain=EventDomain.TOOL,
                    action=EventAction.INVOKE,
                    metadata={
                        "tool_name": tool_name,
                        "iteration": str(iteration + 1),
                    },
                )
                await self._event_bus.publish(tool_call_event)

                tool_result_event = AgentEvent(
                    trace_id=trace_id,
                    session_id=session_id,
                    user_id=user_id,
                    domain=EventDomain.TOOL,
                    action=EventAction.EXECUTE,
                    metadata={
                        "tool_name": tool_name,
                        "tool_status": tool_result.get("status", "unknown"),
                        "error_code": tool_result.get("error_code", ""),
                        "iteration": str(iteration + 1),
                    },
                )
                await self._event_bus.publish(tool_result_event)

            observation_parts = []
            for r in iteration_results:
                tool_name = r["tool"]
                result = r["result"]
                status = result.get("status", "unknown")
                if status == "success":
                    observation_parts.append(
                        f"Tool '{tool_name}' returned: {json.dumps(result.get('data', {}), ensure_ascii=False)}"
                    )
                else:
                    error_code = result.get("error_code", "UNKNOWN")
                    observation_parts.append(
                        f"Tool '{tool_name}' error ({error_code}): {json.dumps(result.get('data', {}), ensure_ascii=False)}"
                    )
            observation = "\n".join(observation_parts)

            context.setdefault("history", []).append({"role": "assistant", "content": response})

            continuation_prompt = (
                f"[Observation]\n{observation}\n\n"
                "Based on the above tool results, continue your reasoning. "
                "If you have enough information to answer the user's question, "
                "provide your final answer without using any tools. "
                "If you need more information, call another tool."
            )

            try:
                response, _, native_tool_calls = self._llm_adapter.generate(
                    prompt=continuation_prompt,
                    context=context,
                    temperature=config.get("llm.temperature", 0.7),
                    max_tokens=config.get("llm.max_tokens", 512),
                )
            except Exception as e:
                logger.error("LLM re-generation failed at iteration %d: %s", iteration + 1, str(e))
                break
        else:
            logger.warning(
                "Max ReAct iterations (%d) reached for trace_id=%s, forcing final response",
                max_iterations,
                trace_id,
            )

        turn_context = {
            "prompt": prompt,
            "tool_calls": [
                {"tool": tr.get("tool", ""), "result": tr.get("result", {})}
                for tr in tool_results
            ],
            "response": response,
        }

        asyncio.create_task(asyncio.to_thread(
            self._storage_adapter.update_all,
            user_id=user_id,
            new_data=turn_context,
            metadata=self._build_memory_metadata(session_id, trace_id, perception_result),
        ))

        action_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.ACTION,
            action=EventAction.EXECUTE,
            metadata={"tool_count": str(len(tool_results))},
        )
        await self._event_bus.publish(action_event)

        return {
            "status": "success",
            "error_code": "",
            "data": {
                "response": response,
                "tool_results": tool_results,
                "trace_id": trace_id,
            },
        }

    async def stream_request(
        self,
        user_id: str,
        session_id: str,
        input_data: Dict[str, Any],
        trace_id: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        import uuid

        if not trace_id:
            trace_id = str(uuid.uuid4())

        context: Dict[str, Any] = {
            "trace_id": trace_id,
            "session_id": session_id,
            "user_id": user_id,
        }

        config = get_config()

        # 感知层：输入类型路由 + 感知器链（对应问题 9）
        perception_result = self._run_perception_pipeline(input_data, config)

        detected_level = 0
        if perception_result:
            detected_level = perception_result.get("metadata", {}).get("sensitivity_level", 0)

            sensitivity_threshold = config.get("perception.sensitivity_threshold", 5)
            if detected_level >= sensitivity_threshold:
                logger.warning(
                    "Sensitivity circuit breaker triggered: trace_id=%s level=%d",
                    trace_id,
                    detected_level,
                )
                yield SSEEncoder.encode_error(
                    ErrorCode.PERCEPTION_SENSITIVITY_REJECTED,
                    "Input rejected due to sensitive content",
                    trace_id,
                )
                return

            # 安全检测熔断（对应问题 5）
            security_config = config.get("perception.security", {})
            if security_config.get("block_on_injection") and perception_result.get("metadata", {}).get("injection_detected"):
                yield SSEEncoder.encode_error(
                    ErrorCode.PERCEPTION_SENSITIVITY_REJECTED,
                    "Input rejected due to prompt injection detected",
                    trace_id,
                )
                return

        yield SSEEncoder.encode_status("perception", trace_id)

        cleaned_text = None
        if perception_result and perception_result.get("parsed_content"):
            cleaned_text = perception_result["parsed_content"].get("text")

        # 感知结果注入 LLM Context（对应问题 7）
        if perception_result:
            context["perception"] = extract_perception_context(perception_result)
            confidence = perception_result.get("confidence", 1.0)
            if confidence < 0.5:
                logger.info("Low confidence (%.2f), switching to conservative mode", confidence)

        # 感知事件：标准化 metadata（对应问题 11）
        perception_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.PERCEPTION,
            action=EventAction.ANALYZE,
            metadata=build_perception_event_metadata(
                perception_result or {}, input_data.get("input_type", "text")
            ) if perception_result else {
                "input_type": input_data.get("input_type", "text"),
                "sensitivity_level": "0",
                "truncated": "False",
            },
        )
        await self._event_bus.publish(perception_event)

        prompt = cleaned_text if cleaned_text is not None else input_data.get("prompt", "")

        memory_result = self._storage_adapter.query_all(
            user_id=user_id,
            context_window=config.get("memory.context_window", "last_5_turns"),
            required_fields=input_data.get("required_fields", ["user_intent"]),
            query_text=prompt,
        )

        memory_data = memory_result.get("data", {})
        context["history"] = memory_data.get("history", [])
        context["knowledge"] = memory_data.get("knowledge", [])

        yield SSEEncoder.encode_status("memory", trace_id)

        if not prompt:
            yield SSEEncoder.encode_error("INPUT_001", "prompt is required", trace_id)
            return

        prompt_template = config.get("llm.prompt_template", "")
        if prompt_template:
            prompt = prompt_template.replace("{input}", prompt)

        native_tools = self._build_native_tools()
        context["native_tools"] = native_tools

        if native_tools:
            context["tool_descriptions"] = ""
        else:
            tool_descriptions = self._build_tool_descriptions()
            context["tool_descriptions"] = tool_descriptions

        tool_results: List[Dict[str, Any]] = []
        max_iterations = config.get("llm.max_reasoning_iterations", 3)
        max_format_retries = config.get("llm.max_format_retries", 2)
        tool_call_pattern = config.get("llm.tool_call_pattern", r"```tool_call\s*\n(.*?)\n```")

        total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

        # 保守模式：低置信度时降低 temperature（对应问题 7）
        effective_temperature = config.get("llm.temperature", 0.7)
        if perception_result and perception_result.get("confidence", 1.0) < 0.5:
            effective_temperature = min(effective_temperature, 0.3)

        yield SSEEncoder.encode_status("thinking", trace_id)

        try:
            response, _llm_usage, native_tool_calls = await asyncio.to_thread(
                self._llm_adapter.generate,
                prompt=prompt,
                context=context,
                temperature=effective_temperature,
                max_tokens=config.get("llm.max_tokens", 512),
            )
        except Exception as e:
            logger.error("LLM generation failed: %s", str(e))
            yield SSEEncoder.encode_error(ErrorCode.LLM_GENERATION_FAILED, str(e), trace_id)
            return

        if response:
            yield SSEEncoder.encode_thinking(response, trace_id)

        format_retries = 0
        needs_stream_final = True
        for iteration in range(max_iterations):
            yield SSEEncoder.encode_reasoning_iteration(iteration + 1, max_iterations, trace_id)

            if native_tool_calls:
                tool_calls = native_tool_calls
                parse_errors = []
            else:
                tool_calls, parse_errors = self._parse_tool_calls_with_errors(response, tool_call_pattern)

            if not tool_calls and not parse_errors:
                needs_stream_final = False
                break

            if not tool_calls and parse_errors:
                if format_retries < max_format_retries:
                    error_feedback = "\n".join(
                        f"Invalid tool call: {e['raw']}\nError: {e['error']}"
                        for e in parse_errors
                    )
                    context.setdefault("history", []).extend([
                        {"role": "assistant", "content": response},
                        {"role": "user", "content": (
                            f"[Format Error]\n{error_feedback}\n\n"
                            "Please correct your tool call format. Use:\n"
                            '```tool_call\n{"tool": "<tool_name>", "parameters": {<params>}}\n```'
                        )},
                    ])
                    try:
                        response, _usage, native_tool_calls = await asyncio.to_thread(
                            self._llm_adapter.generate,
                            prompt="Please correct your tool call format and try again.",
                            context=context,
                            temperature=config.get("llm.temperature", 0.7),
                            max_tokens=config.get("llm.max_tokens", 512),
                        )
                        total_usage["prompt_tokens"] += _usage.get("prompt_tokens", 0)
                        total_usage["completion_tokens"] += _usage.get("completion_tokens", 0)
                        total_usage["total_tokens"] += _usage.get("total_tokens", 0)
                        if response:
                            yield SSEEncoder.encode_thinking(response, trace_id)
                        format_retries += 1
                        continue
                    except Exception as e:
                        logger.error("LLM self-correction failed: %s", str(e))
                        needs_stream_final = False
                        break
                else:
                    logger.warning(
                        "Max format retries (%d) reached, treating as final response",
                        max_format_retries,
                    )
                    needs_stream_final = False
                    break

            iteration_results: List[Dict[str, Any]] = []
            for tool_call in tool_calls:
                tool_name = tool_call.get("tool", "")
                tool_params = tool_call.get("parameters", {})
                if not tool_name:
                    continue

                tool_id = str(uuid.uuid4())
                tool_args_str = json.dumps(tool_params, ensure_ascii=False)
                tool_start_time = datetime.now(timezone.utc)
                yield SSEEncoder.encode_tool_call_start(tool_id, tool_name, tool_args_str, trace_id)

                tool_result = self._tool_adapter.invoke_tool(
                    tool_name=tool_name,
                    params=tool_params,
                    context=context,
                    timeout_ms=config.get("tools.default_timeout_ms", 1800000),
                )
                tool_end_time = datetime.now(timezone.utc)
                tool_duration_ms = int((tool_end_time - tool_start_time).total_seconds() * 1000)

                tool_result["execution_id"] = tool_id
                tool_result["start_time"] = tool_start_time.isoformat()
                tool_result["end_time"] = tool_end_time.isoformat()
                tool_result["duration_ms"] = tool_duration_ms
                tool_result["input_params"] = tool_params

                iteration_results.append({"tool": tool_name, "result": tool_result})
                tool_results.append(tool_result)

                yield SSEEncoder.encode_tool_call_end(tool_id, tool_name, tool_args_str, trace_id)
                yield SSEEncoder.encode_tool_result(
                    tool_id, tool_name,
                    json.dumps(tool_result.get("data", {}), ensure_ascii=False),
                    tool_result.get("status", "unknown"),
                    trace_id,
                )

                tool_call_event = AgentEvent(
                    trace_id=trace_id,
                    session_id=session_id,
                    user_id=user_id,
                    domain=EventDomain.TOOL,
                    action=EventAction.INVOKE,
                    metadata={"tool_name": tool_name, "iteration": str(iteration + 1)},
                )
                await self._event_bus.publish(tool_call_event)

                tool_result_event = AgentEvent(
                    trace_id=trace_id,
                    session_id=session_id,
                    user_id=user_id,
                    domain=EventDomain.TOOL,
                    action=EventAction.EXECUTE,
                    metadata={
                        "tool_name": tool_name,
                        "tool_status": tool_result.get("status", "unknown"),
                        "error_code": tool_result.get("error_code", ""),
                        "iteration": str(iteration + 1),
                    },
                )
                await self._event_bus.publish(tool_result_event)

            observation_parts = []
            for r in iteration_results:
                tool_name = r["tool"]
                result = r["result"]
                status = result.get("status", "unknown")
                if status == "success":
                    observation_parts.append(
                        f"Tool '{tool_name}' returned: {json.dumps(result.get('data', {}), ensure_ascii=False)}"
                    )
                else:
                    error_code = result.get("error_code", "UNKNOWN")
                    observation_parts.append(
                        f"Tool '{tool_name}' error ({error_code}): {json.dumps(result.get('data', {}), ensure_ascii=False)}"
                    )
            observation = "\n".join(observation_parts)

            context.setdefault("history", []).append({"role": "assistant", "content": response})

            continuation_prompt = (
                f"[Observation]\n{observation}\n\n"
                "Based on the above tool results, continue your reasoning. "
                "If you have enough information to answer the user's question, "
                "provide your final answer without using any tools. "
                "If you need more information, call another tool."
            )

            is_last_iteration = iteration == max_iterations - 1
            if is_last_iteration:
                logger.warning(
                    "Max ReAct iterations (%d) reached for trace_id=%s, streaming final response",
                    max_iterations,
                    trace_id,
                )
                needs_stream_final = True
                break

            try:
                response, _usage, native_tool_calls = await asyncio.to_thread(
                    self._llm_adapter.generate,
                    prompt=continuation_prompt,
                    context=context,
                    temperature=config.get("llm.temperature", 0.7),
                    max_tokens=config.get("llm.max_tokens", 512),
                )
                total_usage["prompt_tokens"] += _usage.get("prompt_tokens", 0)
                total_usage["completion_tokens"] += _usage.get("completion_tokens", 0)
                total_usage["total_tokens"] += _usage.get("total_tokens", 0)
                if response:
                    yield SSEEncoder.encode_thinking(response, trace_id)
            except Exception as e:
                logger.error("LLM re-generation failed at iteration %d: %s", iteration + 1, str(e))
                needs_stream_final = False
                break

        stream_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.REASONING,
            action=EventAction.STREAM,
            metadata={"phase": "start"},
        )
        await self._event_bus.publish(stream_event)

        publisher = StreamPublisher(self._event_bus, trace_id, session_id, user_id)

        full_response = ""
        if needs_stream_final:
            continuation_prompt_for_stream = (
                f"[Observation]\nPlease provide your final answer based on the conversation so far. "
                "Do not use any tools, just respond with your final answer."
            )
            try:
                for token in self._llm_adapter.stream(
                    prompt=continuation_prompt_for_stream, context=context,
                ):
                    full_response += token
                    yield SSEEncoder.encode_token(token, trace_id)
                    await publisher.publish_token(token)
            except Exception as e:
                logger.error("LLM stream error: %s", str(e))
                yield SSEEncoder.encode_error(ErrorCode.LLM_STREAM_ERROR, str(e), trace_id)
        else:
            chunk_size = config.get("streaming.chunk_size", 4)
            try:
                position = 0
                while position < len(response):
                    token = response[position:position + chunk_size]
                    position += chunk_size
                    full_response += token
                    yield SSEEncoder.encode_token(token, trace_id)
                    await publisher.publish_token(token)
            except Exception as e:
                logger.error("Stream publish error: %s", str(e))
                yield SSEEncoder.encode_error(ErrorCode.LLM_STREAM_ERROR, str(e), trace_id)

        stream_end_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.REASONING,
            action=EventAction.STREAM,
            metadata={"phase": "end", "total_tokens": str(len(full_response))},
        )
        await self._event_bus.publish(stream_end_event)

        turn_context = {
            "prompt": prompt,
            "tool_calls": [
                {"tool": tr.get("tool", ""), "result": tr.get("result", {})}
                for tr in tool_results
            ],
            "response": full_response,
        }

        asyncio.create_task(asyncio.to_thread(
            self._storage_adapter.update_all,
            user_id=user_id,
            new_data=turn_context,
            metadata=self._build_memory_metadata(session_id, trace_id, perception_result),
        ))

        yield SSEEncoder.encode_done(trace_id, tool_results, total_usage)

    def _build_memory_metadata(
        self,
        session_id: str,
        trace_id: str,
        perception_result: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """构建记忆存储元数据（P1：感知结果影响记忆存储）。

        将感知层提取的关键信息注入记忆元数据，支持：
        - 按语种检索记忆
        - 按敏感度级别过滤记忆
        - 按意图分类检索记忆
        - 实体标注辅助记忆关联
        """
        metadata: Dict[str, Any] = {
            "session_id": session_id,
            "trace_id": trace_id,
        }

        if not perception_result:
            return metadata

        # 语种标注
        language = perception_result.get("detected_language")
        if language:
            metadata["language"] = language

        # 敏感度级别标注（高敏感记忆可被过滤）
        sensitivity = perception_result.get("metadata", {}).get("sensitivity_level", 0)
        if sensitivity:
            metadata["sensitivity_level"] = str(sensitivity)

        # 意图标注
        intent = perception_result.get("intent")
        if intent:
            metadata["intent"] = intent if isinstance(intent, str) else intent.get("intent", "")

        # 实体标注（用于记忆关联）
        entities = perception_result.get("entities", [])
        if entities:
            entity_texts = [
                e.get("text", "") for e in entities if isinstance(e, dict)
            ]
            metadata["entities"] = ",".join(entity_texts[:10])

        # 置信度标注
        confidence = perception_result.get("confidence")
        if confidence is not None:
            metadata["perception_confidence"] = str(round(confidence, 3))

        # 输入类型
        input_type = perception_result.get("parsed_content", {}).get("input_type")
        if input_type:
            metadata["input_type"] = input_type

        return metadata

    def _build_native_tools(self) -> List[Dict[str, Any]]:
        """将注册表中的工具转换为 OpenAI function calling 格式。"""
        available_tools = self._tool_adapter.list_available_tools()
        native_tools = []
        for name, info in available_tools.items():
            native_tools.append({
                "type": "function",
                "function": {
                    "name": name,
                    "description": info.get("description", ""),
                    "parameters": info.get("parameters_schema", {}),
                }
            })
        return native_tools

    def _build_tool_descriptions(self) -> str:
        available_tools = self._tool_adapter.list_available_tools()
        if not available_tools:
            return ""

        descriptions = []
        for tool_name, tool_info in available_tools.items():
            desc = tool_info.get("description", "")
            schema = tool_info.get("parameters_schema", {})
            descriptions.append(
                f"- {tool_name}: {desc}\n  Parameters: {json.dumps(schema, ensure_ascii=False)}"
            )

        header = (
            "You have access to the following tools. "
            "If you need to use a tool, output a tool call in this format:\n"
            "```tool_call\n"
            '{"tool": "<tool_name>", "parameters": {<params>}}\n'
            "```\n"
            "You can use multiple tool calls. If no tool is needed, just respond normally.\n"
        )
        return header + "\n".join(descriptions)

    @staticmethod
    def _parse_tool_calls_with_errors(
        response: str, pattern: str,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
        matches = re.findall(pattern, response, re.DOTALL)
        tool_calls: List[Dict[str, Any]] = []
        parse_errors: List[Dict[str, str]] = []
        for match in matches:
            try:
                parsed = json.loads(match.strip())
                if isinstance(parsed, dict) and "tool" in parsed:
                    tool_calls.append(parsed)
                elif isinstance(parsed, list):
                    for item in parsed:
                        if isinstance(item, dict) and "tool" in item:
                            tool_calls.append(item)
            except json.JSONDecodeError as e:
                logger.warning("Failed to parse tool call JSON: %s", match[:100])
                parse_errors.append({"raw": match[:200], "error": str(e)})
        return tool_calls, parse_errors

    # ------------------------------------------------------------------
    # 感知器管线（对应问题 9：输入路由 + 多感知融合）
    # ------------------------------------------------------------------

    def _run_perception_pipeline(
        self,
        input_data: Dict[str, Any],
        config,
    ) -> Optional[Dict[str, Any]]:
        """根据 input_type 路由到感知器链，执行多路感知并融合。

        管线流程：
        1. 根据 input_type 从 routing 配置获取感知器链
        2. 依次执行每个感知器，前一个的输出文本作为后一个的输入
        3. 若有多个感知器结果，使用 PerceptionFusion 融合
        """
        input_type = input_data.get("input_type", "text")
        raw_content = input_data.get("prompt", "").encode("utf-8")
        sensitivity_level = input_data.get("sensitivity_level", 0)

        # 获取路由配置
        routing = config.get("perception.routing", {})
        pipeline_config = routing.get(input_type, {})
        pipeline: List[str] = pipeline_config.get("pipeline", ["text_preprocessor"])

        if not pipeline:
            pipeline = ["text_preprocessor"]

        results: List[Dict[str, Any]] = []
        current_content = raw_content
        current_input_type = input_type

        for processor_name in pipeline:
            perception = self._registry.get_perception(processor_name)
            if perception is None:
                logger.warning("Perception component '%s' not registered, skipping", processor_name)
                continue

            try:
                result = perception.perceive(
                    input_type=current_input_type,
                    raw_content=current_content,
                    sensitivity_level=sensitivity_level,
                )
                results.append(result)

                # 管线传递：若感知器输出转为文本，则后续感知器以文本为输入
                parsed = result.get("parsed_content", {})
                if parsed.get("text") and parsed.get("input_type") == "text":
                    current_content = parsed["text"].encode("utf-8")
                    current_input_type = "text"

            except Exception as e:
                logger.error("Perception '%s' failed: %s", processor_name, str(e))
                continue

        if not results:
            return None

        # 单路结果直接返回
        if len(results) == 1:
            return results[0]

        # 多路融合
        return self._fusion.fuse(results)

    # ------------------------------------------------------------------
    # Sensor 生命周期管理（对应问题 8：BaseSensor 接口集成）
    # ------------------------------------------------------------------

    async def start_sensors(self, sensor_names: List[str]) -> None:
        """启动指定的传感器，后台异步运行。

        传感器捕获的数据通过 EventBus 发布为 PERCEPTION 域事件。
        """
        for name in sensor_names:
            if name in self._sensor_tasks:
                logger.warning("Sensor '%s' already running", name)
                continue

            sensor = self._registry.get_sensor(name)
            if sensor is None:
                logger.warning("Sensor '%s' not registered, skipping", name)
                continue

            self._sensor_tasks[name] = asyncio.create_task(
                self._run_sensor(name, sensor)
            )
            logger.info("Started sensor: %s", name)

    async def stop_sensors(self, sensor_names: Optional[List[str]] = None) -> None:
        """停止指定的传感器，未指定则停止全部。"""
        names = sensor_names or list(self._sensor_tasks.keys())
        for name in names:
            task = self._sensor_tasks.pop(name, None)
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                logger.info("Stopped sensor: %s", name)

    async def _run_sensor(self, name: str, sensor: BaseSensor) -> None:
        """传感器运行循环：定时捕获并发布事件。"""
        logger.info("Sensor '%s' (type=%s) started", name, sensor.sensor_type())
        try:
            while True:
                try:
                    raw_data = sensor.capture({"user_id": "system"})
                    if raw_data:
                        event = AgentEvent(
                            trace_id=f"sensor_{name}",
                            session_id="sensor",
                            user_id="system",
                            domain=EventDomain.PERCEPTION,
                            action=EventAction.ANALYZE_SCENE,
                            payload=raw_data,
                            metadata={
                                "sensor_name": name,
                                "sensor_type": sensor.sensor_type(),
                                "data_size": str(len(raw_data)),
                            },
                        )
                        await self._event_bus.publish(event)
                except Exception as e:
                    logger.error("Sensor '%s' capture error: %s", name, str(e))

                await asyncio.sleep(1.0)  # 采集间隔
        except asyncio.CancelledError:
            logger.info("Sensor '%s' cancelled", name)
            raise
