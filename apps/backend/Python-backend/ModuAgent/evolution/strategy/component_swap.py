from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Optional

from core.registry import ComponentRegistry
from feedback.evolution_signal import EvolutionSignalCollector


class ComponentSwapStrategy:
    """基于质量对比的组件热替换策略。"""

    def __init__(
        self,
        registry: ComponentRegistry,
        feedback_collector: EvolutionSignalCollector,
        threshold: float = 0.05,
    ):
        self._registry = registry
        self._feedback_collector = feedback_collector
        self._threshold = threshold
        self._performance_history: Dict[str, List[float]] = defaultdict(list)

    def record_score(
        self,
        component_name: str,
        version: str,
        score: float,
    ) -> None:
        """记录组件版本的得分。

        Args:
            component_name: 组件名称
            version: 版本标识
            score: A/B 测试得分
        """
        key = f"{component_name}:{version}"
        self._performance_history[key].append(score)

    def _get_average_score(
        self,
        component_name: str,
        version: str,
    ) -> Optional[float]:
        """获取组件版本的平均得分。

        Args:
            component_name: 组件名称
            version: 版本标识

        Returns:
            平均得分，如果无历史数据则返回 None
        """
        key = f"{component_name}:{version}"
        scores = self._performance_history.get(key, [])
        if not scores:
            return None
        return sum(scores) / len(scores)

    def should_swap(
        self,
        component_name: str,
        current_version: str,
        candidate_version: str,
        threshold: Optional[float] = None,
    ) -> bool:
        """判断是否应切换组件。

        条件：候选版本平均得分 > 当前版本平均得分 + 阈值

        Args:
            component_name: 组件名称
            current_version: 当前版本
            candidate_version: 候选版本
            threshold: 切换阈值，默认使用构造函数传入的值

        Returns:
            是否应切换到候选版本
        """
        if threshold is None:
            threshold = self._threshold

        current_avg = self._get_average_score(component_name, current_version)
        candidate_avg = self._get_average_score(component_name, candidate_version)

        if current_avg is None or candidate_avg is None:
            return False

        return candidate_avg > current_avg + threshold
