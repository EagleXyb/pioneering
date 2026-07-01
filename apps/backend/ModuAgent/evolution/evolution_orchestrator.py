"""进化编排器：接通 feedback/evolution 闭环（P0-1）。

将 feedback 模块（FeedbackLoop / QualityMonitor / EvolutionSignalCollector）
与 evolution 模块（ParameterTuneStrategy / VersionedComponentStore / RollbackMechanism）
接入 LangGraph 主流程，形成闭环：

    response → feedback 评估 → should_evolve 判断 → 参数调优 / 回滚

闭环数据流：
    1. FeedbackLoop.evaluate(output, context) → 评估质量
    2. FeedbackLoop.should_evolve(metrics, threshold) → 判断是否进化
    3. ParameterTuneStrategy.analyze_and_adjust(signals) → 调整参数
    4. RollbackMechanism.record_and_check(quality_score) → 回滚检查

Usage:
    orchestrator = EvolutionOrchestrator()
    result = await orchestrator.evaluate_and_evolve(state)
    # result = {"evaluation": {...}, "should_evolve": bool, "evolution_action": {...}}
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from config.runtime_config import get_config
from feedback.evolution_signal import EvolutionSignalCollector
from feedback.loop_controller import FeedbackLoop

logger = logging.getLogger(__name__)


class EvolutionOrchestrator:
    """进化编排器：协调 feedback 评估与 evolution 策略。

    P0-1: 接通 feedback/evolution 闭环，将以下断裂点连接：
    - response → FeedbackLoop.evaluate（评估响应质量）
    - should_evolve → evolution_threshold（读取配置阈值）
    - should_evolve=True → ParameterTuneStrategy（触发参数调优）
    """

    def __init__(
        self,
        feedback_loop: Optional[FeedbackLoop] = None,
        evolution_collector: Optional[EvolutionSignalCollector] = None,
        parameter_tune: Optional[Any] = None,
        evaluator_llm: Optional[Any] = None,
    ) -> None:
        """初始化进化编排器。

        Args:
            feedback_loop: 反馈循环控制器（None=自动创建）
            evolution_collector: 进化信号收集器（None=自动创建）
            parameter_tune: 参数调优策略（None=自动创建）
            evaluator_llm: P2-7 LLM-as-Judge 评估器（None=按配置决定是否创建）。
                当 feedback.quality_monitor_mode 为 "llm"/"hybrid" 时启用。
        """
        config = get_config()

        self._evolution_collector = evolution_collector or EvolutionSignalCollector(
            report_interval=config.get("perception.evolution_report_interval", 100),
        )

        # P2-7: 按 config 构造 QualityMonitor（支持 LLM-as-Judge）
        if feedback_loop is None:
            quality_monitor = self._build_quality_monitor(config, evaluator_llm)
            self._feedback_loop = FeedbackLoop(
                quality_monitor=quality_monitor,
                evolution_collector=self._evolution_collector,
                min_sample_size=config.get("feedback.min_sample_size", 10),
            )
        else:
            self._feedback_loop = feedback_loop

        # 参数调优策略（延迟初始化以避免循环导入）
        self._parameter_tune = parameter_tune
        if self._parameter_tune is None:
            try:
                from evolution.strategy.parameter_tune import ParameterTuneStrategy
                self._parameter_tune = ParameterTuneStrategy(
                    config=config,
                    feedback_collector=self._evolution_collector,
                )
            except Exception as e:
                logger.warning("ParameterTuneStrategy init failed: %s", str(e))
                self._parameter_tune = None

    @staticmethod
    def _build_quality_monitor(
        config: Any,
        evaluator_llm: Optional[Any],
    ) -> Optional["QualityMonitor"]:
        """P2-7: 根据 config 和 evaluator_llm 构造 QualityMonitor。

        构造规则：
            - mode="rule"（默认）→ 不需要 evaluator_llm，规则模式
            - mode="llm"/"hybrid" 且 evaluator_llm 提供 → 启用 LLM Judge
            - mode="llm"/"hybrid" 但 evaluator_llm 缺失 → QualityMonitor 内部自动降级为 rule
        """
        try:
            from feedback.quality_monitor import QualityMonitor
        except ImportError as e:
            logger.warning("QualityMonitor import failed: %s", str(e))
            return None

        mode = config.get("feedback.quality_monitor_mode", "rule")
        llm_timeout = config.get("feedback.quality_monitor_llm_timeout", 10.0)
        llm_temperature = config.get("feedback.quality_monitor_llm_temperature", 0.0)
        llm_max_tokens = config.get("feedback.quality_monitor_llm_max_tokens", 256)

        return QualityMonitor(
            evaluator_llm=evaluator_llm,
            mode=mode,
            llm_timeout=llm_timeout,
            llm_temperature=llm_temperature,
            llm_max_tokens=llm_max_tokens,
        )

    @property
    def feedback_loop(self) -> FeedbackLoop:
        return self._feedback_loop

    @property
    def evolution_collector(self) -> EvolutionSignalCollector:
        return self._evolution_collector

    async def evaluate_and_evolve(
        self,
        output: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """评估输出质量并决定是否触发进化。

        P0-1 闭环核心方法，在 feedback_node 中调用。

        Args:
            output: 输出字典，包含 response / tool_results / usage
            context: 上下文字典，包含 prompt / perception_result 等

        Returns:
            评估与进化结果字典：
                {
                    "evaluation": {...},        # 质量评估结果
                    "should_evolve": bool,       # 是否应进化
                    "evolution_action": {...},   # 进化动作（参数调优等）
                    "sample_count": int,         # 累积样本数
                }
        """
        # 1. 评估输出质量
        try:
            evaluation = await self._feedback_loop.evaluate(output, context)
        except Exception as e:
            logger.error("Feedback evaluation failed: %s", str(e))
            evaluation = {"quality_score": 0.0, "error": str(e)}

        # 2. 读取进化阈值配置并判断是否应进化
        config = get_config()
        threshold = config.get("feedback.evolution_threshold", 0.6)
        should_evolve = self._feedback_loop.should_evolve(evaluation, threshold)

        result: Dict[str, Any] = {
            "evaluation": evaluation,
            "should_evolve": should_evolve,
            "evolution_action": None,
            "sample_count": self._feedback_loop.get_sample_count(),
        }

        # 3. 触发参数调优
        if should_evolve and self._parameter_tune is not None:
            try:
                signals = self._evolution_collector.get_signals()
                # 将评估结果注入信号 context，供 ParameterTuneStrategy 提取
                if signals:
                    for signal in signals[-self._feedback_loop.get_sample_count():]:
                        if "evaluation" not in signal.context:
                            signal.context["evaluation"] = evaluation

                evolution_action = self._parameter_tune.analyze_and_adjust(signals)
                result["evolution_action"] = evolution_action

                if evolution_action.get("adjusted"):
                    logger.info(
                        "Evolution triggered: sample_count=%d quality_score=%.3f threshold=%.2f reasons=%s",
                        self._feedback_loop.get_sample_count(),
                        evaluation.get("quality_score", 0.0),
                        threshold,
                        evolution_action.get("reasons", []),
                    )
            except Exception as e:
                logger.error("Evolution adjustment failed: %s", str(e))
                result["evolution_action"] = {"adjusted": False, "error": str(e)}

        return result

    def get_cumulative_metrics(self) -> Dict[str, float]:
        """获取累积指标统计。"""
        return self._feedback_loop.get_cumulative_metrics()

    def reset(self) -> None:
        """重置累积数据。"""
        self._feedback_loop.reset()
