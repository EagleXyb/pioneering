from __future__ import annotations

from typing import Any, Dict, List, Optional

from config.runtime_config import RuntimeConfig
from feedback.evolution_signal import EvolutionSignal, EvolutionSignalCollector


class ParameterTuneStrategy:
    """基于反馈信号的参数调优策略。

    P0-2 修复：不再直接修改全局 RuntimeConfig，
    而是返回调整建议（config_overrides），
    由调用方注入 RunnableConfig.configurable 实现 per-session 覆盖。
    """

    # 调优阈值
    ACCURACY_THRESHOLD = 0.6
    ITERATIONS_THRESHOLD = 10
    TOOL_FAILURE_THRESHOLD = 0.3

    # 调整步长
    TEMPERATURE_STEP = 0.1
    MAX_ITERATIONS_STEP = 2

    # 边界值
    MIN_TEMPERATURE = 0.1
    MAX_TEMPERATURE = 1.0
    MIN_MAX_ITERATIONS = 1
    MAX_MAX_ITERATIONS = 20

    def __init__(
        self,
        config: RuntimeConfig,
        feedback_collector: EvolutionSignalCollector,
    ):
        """初始化参数调优器。

        调优参数：
        - temperature：温度参数（影响创造性）
        - max_iterations：最大迭代次数（影响深度）
        """
        self._config = config
        self._collector = feedback_collector

    def analyze_and_adjust(
        self,
        signals: List[EvolutionSignal],
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """分析进化信号并生成参数调整建议。

        P0-2 修复：不再修改全局 config，而是返回 config_overrides，
        由调用方注入 RunnableConfig.configurable。

        策略：
        - 低准确性 → 降低 temperature（更保守）
        - 高迭代次数 → 降低 max_iterations（节省资源）
        - 高工具失败率 → 保持低 temperature

        Args:
            signals: 进化信号列表
            session_id: 会话标识（用于标记调整建议的作用域）

        Returns:
            包含调整建议的字典：
            - adjusted: 是否有调整
            - config_overrides: 可注入 RunnableConfig.configurable 的覆盖字典
            - scope: 作用域（session / user / global）
            - session_id: 会话标识
            - temperature: 调整后的 temperature
            - max_iterations: 调整后的 max_iterations
            - reasons: 调整原因列表
            - analyzed_metrics: 分析后的指标
        """
        if not signals:
            current_temp = self._config.get("llm.temperature", 0.7)
            current_max_iter = self._config.get("llm.max_reasoning_iterations", 3)
            return {
                "adjusted": False,
                "config_overrides": {},
                "scope": "session",
                "session_id": session_id,
                "temperature": current_temp,
                "max_iterations": current_max_iter,
                "reasons": [],
                "analyzed_metrics": {},
            }

        # 分析信号提取指标
        metrics = self._extract_metrics(signals)

        current_temp = self._config.get("llm.temperature", 0.7)
        current_max_iter = self._config.get("llm.max_reasoning_iterations", 3)

        new_temp = current_temp
        new_max_iter = current_max_iter
        reasons = []

        # 低准确性 → 降低 temperature
        if metrics["accuracy"] < self.ACCURACY_THRESHOLD:
            new_temp = max(self.MIN_TEMPERATURE, current_temp - self.TEMPERATURE_STEP)
            reasons.append(
                f"低准确性 ({metrics['accuracy']:.2f} < {self.ACCURACY_THRESHOLD}) → "
                f"降低 temperature {current_temp} → {new_temp}"
            )

        # 高迭代次数 → 降低 max_iterations
        if metrics["iterations"] > self.ITERATIONS_THRESHOLD:
            new_max_iter = max(
                self.MIN_MAX_ITERATIONS, current_max_iter - self.MAX_ITERATIONS_STEP
            )
            reasons.append(
                f"高迭代次数 ({metrics['iterations']} > {self.ITERATIONS_THRESHOLD}) → "
                f"降低 max_iterations {current_max_iter} → {new_max_iter}"
            )

        # 高工具失败率 → 保持低 temperature
        if metrics["tool_failure_rate"] > self.TOOL_FAILURE_THRESHOLD:
            # 确保 temperature 不会升高
            if new_temp > current_temp:
                new_temp = current_temp
            reasons.append(
                f"高工具失败率 ({metrics['tool_failure_rate']:.2f} > {self.TOOL_FAILURE_THRESHOLD}) → "
                f"保持低 temperature {new_temp}"
            )

        # 构建 config_overrides（不再修改全局 config）
        adjusted = False
        config_overrides: Dict[str, Any] = {}

        if new_temp != current_temp:
            config_overrides["temperature"] = new_temp
            adjusted = True
        if new_max_iter != current_max_iter:
            config_overrides["max_reasoning_iterations"] = new_max_iter
            adjusted = True

        return {
            "adjusted": adjusted,
            "config_overrides": config_overrides,
            "scope": "session",
            "session_id": session_id,
            "temperature": new_temp,
            "max_iterations": new_max_iter,
            "reasons": reasons,
            "analyzed_metrics": metrics,
        }

    def _extract_metrics(self, signals: List[EvolutionSignal]) -> Dict[str, float]:
        """从进化信号中提取关键指标。

        Returns:
            包含 accuracy, iterations, tool_failure_rate 的字典
        """
        total_tool_calls = 0
        failed_tool_calls = 0
        iterations = 0
        accuracy_sum = 0.0
        accuracy_count = 0

        for signal in signals:
            # 从信号类型判断
            signal_type = signal.signal_type.lower()
            metrics = signal.metrics
            context = signal.context

            # 从 metrics 直接提取 accuracy
            if "accuracy" in metrics:
                accuracy_sum += float(metrics["accuracy"])
                accuracy_count += 1
            elif "accuracy" in context:
                accuracy_sum += float(context["accuracy"])
                accuracy_count += 1
            elif "evaluation" in context:
                eval_data = context["evaluation"]
                if isinstance(eval_data, dict) and "accuracy" in eval_data:
                    accuracy_sum += float(eval_data["accuracy"])
                    accuracy_count += 1

            # 从 metrics 直接提取 iterations
            if "iterations" in metrics:
                iterations += int(metrics["iterations"])
            elif "reasoning" in signal_type or "generate" in signal_type:
                iterations += int(metrics.get("event_count", 1))

            # 统计工具调用和失败
            if "tool" in signal_type or "tool_failure" in signal_type:
                total_tool_calls += 1
                metadata = context.get("metadata", {})
                tool_status = metadata.get("tool_status", "")
                tool_failure_rate = metrics.get("tool_failure_rate", 0.0)
                if tool_status == "failed" or tool_status == "error" or tool_failure_rate > 0:
                    failed_tool_calls += 1
                # 从 metrics 提取失败率
                if "tool_failure_rate" in metrics:
                    failed_tool_calls = int(metrics["tool_failure_rate"] * total_tool_calls)

        # 计算最终指标
        accuracy = accuracy_sum / accuracy_count if accuracy_count > 0 else 1.0
        tool_failure_rate = (
            failed_tool_calls / total_tool_calls if total_tool_calls > 0 else 0.0
        )

        return {
            "accuracy": accuracy,
            "iterations": iterations,
            "tool_failure_rate": tool_failure_rate,
            "total_tool_calls": total_tool_calls,
            "failed_tool_calls": failed_tool_calls,
        }
