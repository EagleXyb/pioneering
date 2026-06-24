from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List

from orchestration.communication.protocol import AgentEvent


@dataclass
class EvolutionSignal:
    """进化信号数据结构。"""

    signal_type: str
    source: str
    timestamp: float
    metrics: Dict[str, float]
    context: Dict[str, Any]
    severity: str  # "low" / "medium" / "high"


class EvolutionSignalCollector:
    """进化信号收集器：从 EventBus 订阅事件并生成进化信号。"""

    def __init__(self, report_interval: int = 100):
        self._signals: List[EvolutionSignal] = []
        self._counters: Dict[str, int] = defaultdict(int)
        self._report_interval = report_interval

    def on_agent_event(self, event: AgentEvent | None) -> None:
        """EventBus 订阅回调：收集推理事件。

        Args:
            event: AgentEvent 实例，None 时跳过
        """
        if event is None:
            return

        counter_key = f"{event.domain}:{event.action}"
        self._counters[counter_key] += 1

        if self._counters[counter_key] % self._report_interval == 0:
            signal = self._create_signal(event, counter_key)
            self._signals.append(signal)

    def _create_signal(self, event: AgentEvent, counter_key: str) -> EvolutionSignal:
        """根据事件创建进化信号。"""
        signal_type = counter_key
        source = f"{event.domain}.{event.action}"

        priority_severity = {
            "low": "low",
            "normal": "medium",
            "high": "high",
            "critical": "high",
        }
        severity = priority_severity.get(event.priority.value, "medium")

        metrics = {
            "event_count": float(self._counters[counter_key]),
            "priority_score": float(event.priority.value == "high" or event.priority.value == "critical"),
        }

        context = {
            "domain": event.domain,
            "action": event.action,
            "event_id": event.event_id,
            "trace_id": event.trace_id,
            "session_id": event.session_id,
            "metadata": event.metadata,
        }

        return EvolutionSignal(
            signal_type=signal_type,
            source=source,
            timestamp=time.time(),
            metrics=metrics,
            context=context,
            severity=severity,
        )

    def get_signals(self) -> List[EvolutionSignal]:
        """获取累积的进化信号。"""
        return list(self._signals)
