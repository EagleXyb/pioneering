from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

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
)

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

        perception_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.PERCEPTION,
            action=EventAction.ANALYZE,
            metadata={"input_type": input_data.get("input_type", "text")},
        )
        await self._event_bus.publish(perception_event)

        config = get_config()
        memory_result = self._storage_adapter.query(
            user_id=user_id,
            context_window=config.get("memory.context_window", "last_5_turns"),
            required_fields=input_data.get("required_fields", ["user_intent"]),
        )

        reasoning_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.REASONING,
            action=EventAction.GENERATE,
            metadata={"has_memory": memory_result.get("status") == "success"},
        )
        await self._event_bus.publish(reasoning_event)

        prompt = input_data.get("prompt", "")
        if not prompt:
            return {"status": "error", "error_code": "INPUT_001", "data": {"message": "prompt is required"}}

        try:
            response = self._llm_adapter.generate(
                prompt=prompt,
                context=context,
                temperature=config.get("llm.temperature", 0.7),
                max_tokens=config.get("llm.max_tokens", 512),
            )
        except Exception as e:
            logger.error("LLM generation failed: %s", str(e))
            return {"status": "error", "error_code": "LLM_001", "data": {"message": str(e)}}

        tools_to_call = input_data.get("tools", [])
        tool_results: List[Dict[str, Any]] = []
        for tool_spec in tools_to_call:
            tool_result = self._tool_adapter.invoke_tool(
                tool_name=tool_spec.get("name", ""),
                params=tool_spec.get("parameters", {}),
                context=context,
                timeout_ms=tool_spec.get("timeout_ms", config.get("tools.default_timeout_ms", 3000)),
                required_fields=tool_spec.get("required_fields"),
            )
            tool_results.append(tool_result)

        self._storage_adapter.update(
            user_id=user_id,
            new_data={"prompt": prompt, "response": response},
            metadata={"session_id": session_id, "trace_id": trace_id},
        )

        action_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.ACTION,
            action=EventAction.EXECUTE,
            metadata={"tool_count": str(len(tools_to_call))},
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
