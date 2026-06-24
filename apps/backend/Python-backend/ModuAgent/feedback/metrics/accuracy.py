from typing import Any, Dict, List, Optional


class AccuracyMetrics:
    """工具调用准确性指标。"""

    def calculate(
        self,
        tool_results: List[Dict[str, Any]],
        expected_results: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, float]:
        """计算工具调用准确性。

        指标：
        - success_rate：工具调用成功率
        - error_rate：错误率
        - avg_time：平均执行时间
        """
        if not tool_results:
            return {
                "success_rate": 0.0,
                "error_rate": 0.0,
                "avg_time": 0.0,
            }

        total = len(tool_results)
        success_count = 0
        error_count = 0
        total_time = 0.0

        for result in tool_results:
            if result.get("success", False):
                success_count += 1
            else:
                error_count += 1

            if "execution_time" in result:
                total_time += result["execution_time"]

        return {
            "success_rate": success_count / total,
            "error_rate": error_count / total,
            "avg_time": total_time / total if total > 0 else 0.0,
        }
