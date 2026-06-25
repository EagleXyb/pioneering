from __future__ import annotations

from typing import Dict


class EfficiencyMetrics:
    """系统效率指标。"""

    def calculate(
        self,
        usage: Dict[str, int],
        iteration_count: int,
        latency_ms: float,
    ) -> Dict[str, float]:
        """计算效率指标。

        指标：
        - token_efficiency：token 效率（output_tokens / input_tokens）
        - iteration_efficiency：迭代效率（有用输出 / 迭代次数）
        - tokens_per_second：吞吐量
        """
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)

        # token_efficiency: output_tokens / input_tokens
        if input_tokens > 0:
            token_efficiency = output_tokens / input_tokens
        else:
            token_efficiency = 0.0

        # iteration_efficiency: output_tokens / iteration_count
        if iteration_count > 0:
            iteration_efficiency = output_tokens / iteration_count
        else:
            iteration_efficiency = 0.0

        # tokens_per_second: total_tokens / (latency_ms / 1000)
        total_tokens = input_tokens + output_tokens
        if latency_ms > 0:
            tokens_per_second = total_tokens / (latency_ms / 1000)
        else:
            tokens_per_second = 0.0

        return {
            "token_efficiency": token_efficiency,
            "iteration_efficiency": iteration_efficiency,
            "tokens_per_second": tokens_per_second,
        }
