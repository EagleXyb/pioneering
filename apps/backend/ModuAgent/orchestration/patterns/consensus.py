"""P3-12.3.1 多 Agent 共识模式（真正共识算法实现）。

重构原 stub（仅取首个成功结果）为三种可插拔共识策略：
    MajorityVoteStrategy   — 多数投票：按内容哈希分组取最大组
    WeightedAggregateStrategy — 加权聚合：按子 Agent 权重合并
    LLMJudgeStrategy       — LLM 裁决：调用 LLM 从多结果中选最优

共识失败时发布 FEEDBACK 事件作为进化信号。
向后兼容：保留原 reach_consensus 方法签名。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, List, Optional

from orchestration.communication.message_bus import get_event_bus
from orchestration.communication.protocol import (
    AgentEvent,
    EventAction,
    EventDomain,
    EventPriority,
)

logger = logging.getLogger(__name__)


class ConsensusStrategy(ABC):
    """共识策略抽象接口（P3-12.3.1）。"""

    @abstractmethod
    def aggregate(self, results: List[Dict[str, Any]], quorum: int) -> Dict[str, Any]:
        """聚合多个子 Agent 结果，返回共识结果。"""


class MajorityVoteStrategy(ConsensusStrategy):
    """多数投票策略：对结果做内容哈希分组，取最多组。"""

    def aggregate(self, results: List[Dict[str, Any]], quorum: int) -> Dict[str, Any]:
        if not results:
            return {"consensus": None, "agreement_count": 0, "strategy": "majority_vote"}
        groups: Dict[str, List[Dict[str, Any]]] = {}
        for r in results:
            h = self._content_hash(r)
            groups.setdefault(h, []).append(r)
        max_key = max(groups, key=lambda k: len(groups[k]))
        max_group = groups[max_key]
        return {
            "consensus": max_group[0], "agreement_count": len(max_group),
            "total_results": len(results), "strategy": "majority_vote",
            "group_count": len(groups),
        }

    @staticmethod
    def _content_hash(result: Dict[str, Any]) -> str:
        """对结果内容计算稳定哈希（用于分组）。

        仅对 output 字段哈希（不含 task_type 等元数据），
        使相同输出但不同 task_type 的结果归入同一组。
        """
        output = result.get("output", result)
        try:
            content = json.dumps(output, sort_keys=True, default=str, ensure_ascii=False)
        except (TypeError, ValueError):
            content = str(output)
        return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


class WeightedAggregateStrategy(ConsensusStrategy):
    """加权聚合策略：按子 Agent 权重排序取最优。"""

    def __init__(self, weights: Optional[Dict[str, float]] = None):
        self._weights = weights or {}

    def aggregate(self, results: List[Dict[str, Any]], quorum: int) -> Dict[str, Any]:
        if not results:
            return {"consensus": None, "agreement_count": 0, "strategy": "weighted"}

        def _weight_of(r: Dict[str, Any]) -> float:
            task_type = r.get("task_type", "")
            if task_type in self._weights:
                return float(self._weights[task_type])
            return float(r.get("weight", 1.0))

        sorted_results = sorted(results, key=_weight_of, reverse=True)
        best = sorted_results[0]
        return {
            "consensus": best.get("output", best), "agreement_count": len(results),
            "total_results": len(results), "strategy": "weighted",
            "best_weight": _weight_of(best), "total_weight": sum(_weight_of(r) for r in results),
        }


class LLMJudgeStrategy(ConsensusStrategy):
    """LLM 裁决策略：调用 LLM 从多个结果中选最优。"""

    _JUDGE_PROMPT = (
        "You are an impartial judge. Select the best answer from candidates.\n"
        "Task: {task}\nCandidates:\n{candidates}\n"
        "Respond with ONLY JSON: {{\"winner\": <index>, \"reason\": \"<brief>\"}}"
    )

    def __init__(self, judge_llm: Any, task_description: str = ""):
        self._llm = judge_llm
        self._task = task_description

    def aggregate(self, results: List[Dict[str, Any]], quorum: int) -> Dict[str, Any]:
        if not results:
            return {"consensus": None, "agreement_count": 0, "strategy": "llm_judge"}
        if self._llm is None:
            logger.warning("LLMJudgeStrategy has no judge_llm, falling back to majority vote")
            return MajorityVoteStrategy().aggregate(results, quorum)

        candidates = "\n".join(
            f"[{i}] {json.dumps(r.get('output', r), default=str, ensure_ascii=False)}"
            for i, r in enumerate(results)
        )
        prompt = self._JUDGE_PROMPT.format(task=self._task or "general task", candidates=candidates)
        try:
            from langchain_core.messages import HumanMessage
            resp = self._llm.invoke([HumanMessage(content=prompt)])
            content = getattr(resp, "content", str(resp))
            judge = json.loads(content)
            idx = int(judge.get("winner", 0))
            if 0 <= idx < len(results):
                winner = results[idx]
                return {
                    "consensus": winner.get("output", winner), "agreement_count": 1,
                    "total_results": len(results), "strategy": "llm_judge",
                    "judge_reason": judge.get("reason", ""), "winner_index": idx,
                }
        except Exception as e:  # noqa: BLE001
            logger.warning("LLM judge failed: %s", str(e))

        return {
            "consensus": results[0].get("output", results[0]), "agreement_count": 1,
            "total_results": len(results), "strategy": "llm_judge_fallback",
        }


def create_consensus_strategy(
    strategy_name: str,
    judge_llm: Optional[Any] = None,
    task_description: str = "",
    weights: Optional[Dict[str, float]] = None,
) -> ConsensusStrategy:
    """根据名称创建共识策略。"""
    name = strategy_name.lower().strip()
    if name == "majority_vote":
        return MajorityVoteStrategy()
    if name == "weighted":
        return WeightedAggregateStrategy(weights=weights)
    if name == "llm_judge":
        return LLMJudgeStrategy(judge_llm=judge_llm, task_description=task_description)
    raise ValueError(f"Unknown consensus strategy: {strategy_name}")


class ConsensusPattern:
    """多 Agent 共识模式（P3-12.3.1 重构）。

    支持三种共识策略，共识失败时发布 FEEDBACK 事件作为进化信号。
    """

    def __init__(
        self,
        quorum: int = 2,
        strategy: Optional[ConsensusStrategy] = None,
        event_bus: Any = None,
    ):
        if quorum < 1:
            raise ValueError("quorum must be >= 1")
        self._quorum = quorum
        self._strategy = strategy or MajorityVoteStrategy()
        self._event_bus = event_bus

    @property
    def quorum(self) -> int:
        return self._quorum

    @property
    def strategy(self) -> ConsensusStrategy:
        return self._strategy

    async def reach_consensus(
        self,
        participants: List[Callable[[Dict[str, Any]], Any]],
        input_data: Dict[str, Any],
        timeout_ms: int = 30000,
    ) -> Dict[str, Any]:
        """并行调用多个参与者并达成共识。"""
        if len(participants) < self._quorum:
            return {
                "status": "error", "error_code": "CONSENSUS_001",
                "data": {"message": f"Need at least {self._quorum} participants, got {len(participants)}",
                         "participant_count": len(participants), "quorum": self._quorum},
            }

        tasks = [self._safe_call(p, input_data) for p in participants]
        timeout_sec = max(timeout_ms / 1000.0, 1.0)
        try:
            results = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True), timeout=timeout_sec,
            )
        except asyncio.TimeoutError:
            await self._publish_consensus_failure(input_data, [],
                reason=f"Timeout after {timeout_ms}ms")
            return {
                "status": "error", "error_code": "CONSENSUS_003",
                "data": {"message": f"Consensus timed out after {timeout_ms}ms",
                         "participant_count": len(participants), "quorum": self._quorum},
            }

        valid_results: List[Dict[str, Any]] = []
        for r in results:
            if isinstance(r, Exception):
                logger.warning("Participant error: %s", str(r))
                continue
            if isinstance(r, dict) and r.get("status") == "success":
                valid_results.append(r.get("data", {}))
            elif isinstance(r, dict):
                valid_results.append(r.get("data", r))
            elif r is not None:
                valid_results.append({"output": r})

        if len(valid_results) < self._quorum:
            await self._publish_consensus_failure(input_data, results,
                reason=f"Failed to reach quorum: {len(valid_results)}/{self._quorum}")
            return {
                "status": "error", "error_code": "CONSENSUS_002",
                "data": {"message": "Failed to reach quorum", "valid_count": len(valid_results),
                         "quorum": self._quorum, "total_participants": len(participants)},
            }

        consensus = self._strategy.aggregate(valid_results, self._quorum)
        return {
            "status": "success", "error_code": "",
            "data": {
                "consensus": consensus.get("consensus"),
                "agreement_count": consensus.get("agreement_count", len(valid_results)),
                "total_participants": len(participants), "valid_count": len(valid_results),
                "strategy": consensus.get("strategy", self._strategy.__class__.__name__),
            },
        }

    async def _publish_consensus_failure(
        self, input_data: Dict[str, Any], results: List[Any], reason: str,
    ) -> None:
        """共识失败时发布进化信号事件。"""
        trace_id = input_data.get("trace_id", "")
        session_id = input_data.get("session_id", "")
        user_id = input_data.get("user_id", "system")
        try:
            bus = self._event_bus or get_event_bus()
            event = AgentEvent(
                trace_id=trace_id, session_id=session_id, user_id=user_id,
                domain=EventDomain.FEEDBACK, action=EventAction.ANALYZE,
                priority=EventPriority.HIGH,
                metadata={"consensus_failed": "true", "reason": reason,
                          "result_count": str(len(results)), "quorum": str(self._quorum)},
            )
            await bus.publish(event)
            logger.info("Consensus failure event published (trace_id=%s): %s", trace_id, reason)
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to publish consensus failure event: %s", str(e))

    @staticmethod
    async def _safe_call(func: Callable, data: Dict[str, Any]) -> Any:
        if asyncio.iscoroutinefunction(func):
            return await func(data)
        return func(data)
