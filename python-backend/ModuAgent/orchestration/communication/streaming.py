from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from orchestration.communication.protocol import AgentEvent, EventAction, EventDomain

logger = logging.getLogger(__name__)


class SSEEncoder:
    @staticmethod
    def encode_token(token: str, trace_id: str) -> Dict[str, Any]:
        return {
            "event": "token",
            "data": json.dumps({"token": token, "trace_id": trace_id}, ensure_ascii=False),
        }

    @staticmethod
    def encode_error(error_code: str, message: str, trace_id: str) -> Dict[str, Any]:
        return {
            "event": "error",
            "data": json.dumps(
                {"error_code": error_code, "message": message, "trace_id": trace_id},
                ensure_ascii=False,
            ),
        }

    @staticmethod
    def encode_done(trace_id: str, tool_results: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        return {
            "event": "done",
            "data": json.dumps(
                {"trace_id": trace_id, "tool_results": tool_results or []},
                ensure_ascii=False,
            ),
        }

    @staticmethod
    def to_sse_message(frame: Dict[str, Any]) -> str:
        event = frame.get("event", "message")
        data = frame.get("data", "")
        return f"event: {event}\ndata: {data}\n\n"


class StreamPublisher:
    def __init__(
        self,
        event_bus: Any,
        trace_id: str,
        session_id: str,
        user_id: str,
    ):
        self._event_bus = event_bus
        self._trace_id = trace_id
        self._session_id = session_id
        self._user_id = user_id
        self._token_count = 0

    async def publish_token(self, token: str) -> None:
        self._token_count += 1
        if self._token_count % 10 == 0:
            event = AgentEvent(
                trace_id=self._trace_id,
                session_id=self._session_id,
                user_id=self._user_id,
                domain=EventDomain.REASONING,
                action=EventAction.STREAM,
                metadata={
                    "phase": "progress",
                    "token_count": str(self._token_count),
                },
            )
            await self._event_bus.publish(event)
