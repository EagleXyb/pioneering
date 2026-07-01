from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from core.interfaces.feedback import BaseFeedbackLoop

from .evolution_signal import EvolutionSignalCollector
from .metrics.accuracy import AccuracyMetrics
from .quality_monitor import QualityMonitor


class FeedbackLoop(BaseFeedbackLoop):
    """反馈循环控制器：评估响应质量，决定是否触发进化。

    评估维度：
    - 相关性（relevance）：回答与问题的关联程度
    - 完整性（completeness）：回答是否完整覆盖问题
    - 准确性（accuracy）：事实性错误的数量
    - 工具效用（tool_effectiveness）：工具调用是否成功
    """

    def __init__(
        self,
        quality_monitor: Optional[QualityMonitor] = None,
        accuracy_metrics: Optional[AccuracyMetrics] = None,
        evolution_collector: Optional[EvolutionSignalCollector] = None,
        min_sample_size: int = 10,
    ):
        """初始化反馈循环控制器。

        Args:
            quality_monitor: 质量监控器（默认新建）
            accuracy_metrics: 准确性指标计算器（默认新建）
            evolution_collector: 进化信号收集器
            min_sample_size: 触发进化判断的最小样本量
        """
        self._quality_monitor = quality_monitor or QualityMonitor()
        self._accuracy_metrics = accuracy_metrics or AccuracyMetrics()
        self._evolution_collector = evolution_collector
        self._min_sample_size = min_sample_size
        self._sample_count = 0
        self._cumulative_metrics: Dict[str, List[float]] = {}

    async def evaluate(
        self,
        output: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """评估单次输出的质量。

        P2-7: 改用 `QualityMonitor.evaluate_async()` 以支持 LLM-as-Judge 模式。
        当 quality_monitor 为规则模式时，evaluate_async 退化为同步调用，无额外开销。

        Args:
            output: 输出字典，包含 response / tool_results / usage 等
            context: 上下文字典，包含 prompt / tool_results 等

        Returns:
            评估结果字典，包含各维度得分和综合得分
        """
        prompt = context.get("prompt", "")
        response = output.get("response", "")
        tool_results = output.get("tool_results", [])
        usage = output.get("usage", {})

        # 使用 QualityMonitor 评估响应质量（异步，支持 LLM/hybrid 模式）
        quality_result = await self._quality_monitor.evaluate_async(
            prompt=prompt,
            response=response,
            context=context,
        )

        # 使用 AccuracyMetrics 计算工具调用准确性
        accuracy_result = self._accuracy_metrics.calculate(
            tool_results=tool_results,
        )

        # 构建评估结果
        # P2-7: 若 LLM 已返回 accuracy 维度，优先使用 LLM 的；否则使用工具调用准确率
        llm_accuracy = quality_result.get("accuracy")
        accuracy_score = (
            llm_accuracy if llm_accuracy is not None
            else accuracy_result.get("success_rate", 0.0)
        )

        evaluation = {
            "relevance": quality_result.get("relevance", 0.0),
            "completeness": quality_result.get("completeness", 0.0),
            "accuracy": accuracy_score,
            "tool_effectiveness": accuracy_result.get("success_rate", 0.0),
            "quality_score": quality_result.get("overall", 0.0),
            "accuracy_details": accuracy_result,
            "quality_details": quality_result,
        }

        # 累积样本
        self._accumulate_sample(evaluation)

        return evaluation

    def _accumulate_sample(self, evaluation: Dict[str, Any]) -> None:
        """累积评估样本用于统计。"""
        self._sample_count += 1

        for key in ["relevance", "completeness", "accuracy", "tool_effectiveness", "quality_score"]:
            if key not in self._cumulative_metrics:
                self._cumulative_metrics[key] = []
            self._cumulative_metrics[key].append(evaluation.get(key, 0.0))

    def should_evolve(
        self,
        metrics: Dict[str, float],
        threshold: float,
    ) -> bool:
        """判断是否应触发进化。

        条件：综合得分低于阈值 且 样本量足够。

        Args:
            metrics: 指标字典
            threshold: 质量阈值（0-1）

        Returns:
            是否应触发进化
        """
        # 样本量不足，不触发进化
        if self._sample_count < self._min_sample_size:
            return False

        # 使用综合质量得分判断
        quality_score = metrics.get("quality_score", 1.0)

        # 连续多次低于阈值才触发
        if quality_score < threshold:
            # 检查最近 N 次是否有足够比例低于阈值
            recent_scores = self._cumulative_metrics.get("quality_score", [])
            if len(recent_scores) >= self._min_sample_size:
                recent_low_ratio = sum(1 for s in recent_scores[-self._min_sample_size:] if s < threshold) / self._min_sample_size
                return recent_low_ratio >= 0.6  # 60% 以上低于阈值
        return False

    def get_cumulative_metrics(self) -> Dict[str, float]:
        """获取累积指标统计。

        Returns:
            各维度平均值字典
        """
        result = {}
        for key, values in self._cumulative_metrics.items():
            if values:
                result[f"{key}_avg"] = sum(values) / len(values)
                result[f"{key}_latest"] = values[-1]
        return result

    def get_sample_count(self) -> int:
        """获取已评估样本数。"""
        return self._sample_count

    def reset(self) -> None:
        """重置累积数据和样本计数。"""
        self._sample_count = 0
        self._cumulative_metrics.clear()
