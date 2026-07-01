from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Dict, List, Optional

from orchestration.communication.protocol import AgentEvent, EventDomain

logger = logging.getLogger(__name__)


class ConsensusPattern:
    """多 Agent 共识模式（P2-11 评估：未集成，保留为参考实现）。

    现状：
        - 未被任何生产 API 或 LangGraph 编排流程引用
        - reach_consensus 当前仅取首个成功结果（valid_results[0]），
          非真正的多数投票/结果聚合，仅适用于"任一成功即通过"场景

    未来迁移方向（超出 P2-11 范围）：
        - 迁移为 LangGraph Subgraph，利用 Send API 实现并行多 Agent 执行
        - 在 Subgraph 出口处实现真正的共识算法（多数投票/加权聚合/LLM 裁决）
        - 与 evolution_orchestrator 联动，将共识失败作为进化信号
    """

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
