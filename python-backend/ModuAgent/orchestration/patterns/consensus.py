from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Dict, List, Optional

from orchestration.communication.protocol import AgentEvent, EventDomain

logger = logging.getLogger(__name__)


class ConsensusPattern:
    def __init__(self, quorum: int = 2):
        self._quorum = quorum

    async def reach_consensus(
        self,
        participants: List[Callable[[Dict[str, Any]], Any]],
        input_data: Dict[str, Any],
        timeout_ms: int = 5000,
    ) -> Dict[str, Any]:
        if len(participants) < self._quorum:
            return {
                "status": "error",
                "error_code": "CONSENSUS_001",
                "data": {"message": f"Need at least {self._quorum} participants"},
            }

        tasks = [self._safe_call(p, input_data) for p in participants]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        valid_results = []
        for r in results:
            if isinstance(r, Exception):
                logger.warning("Participant error: %s", str(r))
                continue
            if isinstance(r, dict) and r.get("status") == "success":
                valid_results.append(r.get("data", {}))

        if len(valid_results) < self._quorum:
            return {
                "status": "error",
                "error_code": "CONSENSUS_002",
                "data": {"message": "Failed to reach quorum"},
            }

        return {
            "status": "success",
            "error_code": "",
            "data": {
                "consensus": valid_results[0],
                "agreement_count": len(valid_results),
                "total_participants": len(participants),
            },
        }

    @staticmethod
    async def _safe_call(func: Callable, data: Dict[str, Any]) -> Any:
        if asyncio.iscoroutinefunction(func):
            return await func(data)
        return func(data)
