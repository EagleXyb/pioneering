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
from config.runtime_config import get_config
from core.registry import get_registry
from orchestration.communication.message_bus import get_event_bus
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
        perception_name = config.get("perception.default_processor", "text_preprocessor")
        perception = self._registry.get_perception(perception_name)

        if perception is None:
            logger.warning("Perception component '%s' not registered, skipping perception", perception_name)
            perception_result = None
        else:
            input_type = input_data.get("input_type", "text")
            raw_content = input_data.get("prompt", "").encode("utf-8")
            sensitivity_level = input_data.get("sensitivity_level", 0)

            perception_result = perception.perceive(
                input_type=input_type,
                raw_content=raw_content,
                sensitivity_level=sensitivity_level,
            )

            sensitivity_threshold = config.get("perception.sensitivity_threshold", 5)
            detected_level = perception_result.get("metadata", {}).get("sensitivity_level", 0)

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

        cleaned_text = None
        if perception_result and perception_result.get("parsed_content"):
            cleaned_text = perception_result["parsed_content"].get("text")

        perception_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.PERCEPTION,
            action=EventAction.ANALYZE,
            metadata={
                "input_type": input_data.get("input_type", "text"),
                "sensitivity_level": str(detected_level) if perception_result else "0",
                "truncated": str(perception_result.get("metadata", {}).get("truncated", False)) if perception_result else "False",
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

        tool_descriptions = self._build_tool_descriptions()
        context["tool_descriptions"] = tool_descriptions

        reasoning_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.REASONING,
            action=EventAction.GENERATE,
            metadata={
                "has_tools": str(bool(tool_descriptions)),
                "template_used": str(bool(prompt_template)),
            },
        )
        await self._event_bus.publish(reasoning_event)

        tool_results: List[Dict[str, Any]] = []
        total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        max_iterations = config.get("llm.max_reasoning_iterations", 3)
        max_format_retries = config.get("llm.max_format_retries", 2)
        tool_call_pattern = config.get("llm.tool_call_pattern", r"```tool_call\s*\n(.*?)\n```")

        try:
            response, _llm_usage = self._llm_adapter.generate(
                prompt=prompt,
                context=context,
                temperature=config.get("llm.temperature", 0.7),
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
                        response, _ = self._llm_adapter.generate(
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
                    timeout_ms=config.get("tools.default_timeout_ms", 3000),
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
                response, _ = self._llm_adapter.generate(
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
            metadata={"session_id": session_id, "trace_id": trace_id},
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
        perception_name = config.get("perception.default_processor", "text_preprocessor")
        perception = self._registry.get_perception(perception_name)

        if perception is None:
            logger.warning("Perception component '%s' not registered, skipping perception", perception_name)
            perception_result = None
        else:
            input_type = input_data.get("input_type", "text")
            raw_content = input_data.get("prompt", "").encode("utf-8")
            sensitivity_level = input_data.get("sensitivity_level", 0)

            perception_result = perception.perceive(
                input_type=input_type,
                raw_content=raw_content,
                sensitivity_level=sensitivity_level,
            )

            sensitivity_threshold = config.get("perception.sensitivity_threshold", 5)
            detected_level = perception_result.get("metadata", {}).get("sensitivity_level", 0)

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

        yield SSEEncoder.encode_status("perception", trace_id)

        cleaned_text = None
        if perception_result and perception_result.get("parsed_content"):
            cleaned_text = perception_result["parsed_content"].get("text")

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

        tool_descriptions = self._build_tool_descriptions()
        context["tool_descriptions"] = tool_descriptions

        tool_results: List[Dict[str, Any]] = []
        max_iterations = config.get("llm.max_reasoning_iterations", 3)
        max_format_retries = config.get("llm.max_format_retries", 2)
        tool_call_pattern = config.get("llm.tool_call_pattern", r"```tool_call\s*\n(.*?)\n```")

        yield SSEEncoder.encode_status("thinking", trace_id)

        try:
            response, _llm_usage = await asyncio.to_thread(
                self._llm_adapter.generate,
                prompt=prompt,
                context=context,
                temperature=config.get("llm.temperature", 0.7),
                max_tokens=config.get("llm.max_tokens", 512),
            )
        except Exception as e:
            logger.error("LLM generation failed: %s", str(e))
            yield SSEEncoder.encode_error(ErrorCode.LLM_GENERATION_FAILED, str(e), trace_id)
            return

        yield SSEEncoder.encode_thinking(response, trace_id)

        format_retries = 0
        needs_stream_final = True
        for iteration in range(max_iterations):
            yield SSEEncoder.encode_reasoning_iteration(iteration + 1, max_iterations, trace_id)

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
                        response, _usage = await asyncio.to_thread(
                            self._llm_adapter.generate,
                            prompt="Please correct your tool call format and try again.",
                            context=context,
                            temperature=config.get("llm.temperature", 0.7),
                            max_tokens=config.get("llm.max_tokens", 512),
                        )
                        total_usage["prompt_tokens"] += _usage.get("prompt_tokens", 0)
                        total_usage["completion_tokens"] += _usage.get("completion_tokens", 0)
                        total_usage["total_tokens"] += _usage.get("total_tokens", 0)
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
                    timeout_ms=config.get("tools.default_timeout_ms", 3000),
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
                response, _usage = await asyncio.to_thread(
                    self._llm_adapter.generate,
                    prompt=continuation_prompt,
                    context=context,
                    temperature=config.get("llm.temperature", 0.7),
                    max_tokens=config.get("llm.max_tokens", 512),
                )
                total_usage["prompt_tokens"] += _usage.get("prompt_tokens", 0)
                total_usage["completion_tokens"] += _usage.get("completion_tokens", 0)
                total_usage["total_tokens"] += _usage.get("total_tokens", 0)
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
            metadata={"session_id": session_id, "trace_id": trace_id},
        ))

        yield SSEEncoder.encode_done(trace_id, tool_results, total_usage)

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
