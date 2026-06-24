from __future__ import annotations

from typing import Any, Dict


class QualityMonitor:
    """基于规则的响应质量监控器。"""

    # 扣分关键词
    UNKNOWN_PATTERNS = ["不知道", "无法回答", "无法提供", "不清楚", "不确定"]
    # 低置信度模式
    LOW_CONFIDENCE_PATTERNS = [
        "可能", "也许", "不确定", "大概", "也许吧", "不太确定",
        "不是很确定", "我猜测", "我认为可能", "这可能是一个"
    ]
    # 工具调用失败的模式
    TOOL_FAILURE_PATTERNS = [
        "调用失败", "执行失败", "操作失败", "请求失败", "工具错误"
    ]

    def evaluate(
        self,
        prompt: str,
        response: str,
        context: Dict[str, Any],
    ) -> Dict[str, float]:
        """评估响应质量（基于规则）。

        规则：
        - 空响应 → 0分
        - 包含"不知道"/"无法回答" → 扣分
        - 工具调用失败 → 扣分
        - 低置信度感知 → 降低预期

        返回包含以下维度的评估结果：
        - relevance: 相关性得分 (0-1)
        - completeness: 完整性得分 (0-1)
        - confidence: 置信度得分 (0-1)
        - tool_success: 工具调用成功率 (0-1)
        - overall: 综合得分 (0-1)
        """
        if not response or not response.strip():
            return {
                "relevance": 0.0,
                "completeness": 0.0,
                "confidence": 0.0,
                "tool_success": 0.0,
                "overall": 0.0,
            }

        relevance = self._check_relevance(prompt, response, context)
        completeness = self._check_completeness(prompt, response, context)
        confidence = self._check_confidence(response)
        tool_success = self._check_tool_success(response, context)

        # 计算综合得分（加权平均）
        overall = (
            relevance * 0.3 +
            completeness * 0.3 +
            confidence * 0.2 +
            tool_success * 0.2
        )

        return {
            "relevance": relevance,
            "completeness": completeness,
            "confidence": confidence,
            "tool_success": tool_success,
            "overall": overall,
        }

    def _check_relevance(
        self,
        prompt: str,
        response: str,
        context: Dict[str, Any],
    ) -> float:
        """检查响应与提示的相关性。

        低相关性特征：
        - 响应长度极短
        - 响应与提示关键词无重叠
        - 包含大量无关内容
        """
        if not response or not response.strip():
            return 0.0

        # 提取提示关键词
        prompt_keywords = set(prompt.lower().split())

        # 提取响应关键词
        response_keywords = set(response.lower().split())

        # 过滤停用词
        stop_words = {"的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这"}
        prompt_keywords -= stop_words
        response_keywords -= stop_words

        if not prompt_keywords:
            return 1.0

        # 计算关键词重叠度
        overlap = len(prompt_keywords & response_keywords)
        keyword_ratio = overlap / len(prompt_keywords)

        # 长度合理性检查
        response_length = len(response.strip())
        prompt_length = len(prompt.strip())

        # 响应过短（少于提示的10%）且关键词重叠低
        if response_length < max(10, prompt_length * 0.1):
            if keyword_ratio < 0.2:
                return 0.2  # 低相关性

        # 检查响应是否答非所问
        if keyword_ratio < 0.1:
            return 0.3

        # 基于关键词重叠度计算相关性
        relevance = min(1.0, keyword_ratio + 0.5)
        return max(0.3, relevance)

    def _check_completeness(
        self,
        prompt: str,
        response: str,
        context: Dict[str, Any],
    ) -> float:
        """检查响应的完整性。

        不完整响应特征：
        - 以问号结尾
        - 包含省略号
        - 句子被截断
        - 缺乏具体信息
        """
        if not response or not response.strip():
            return 0.0

        completeness = 1.0

        # 检查是否有未完成的句子
        incomplete_patterns = ["？", "?", "..."]
        for pattern in incomplete_patterns:
            if response.rstrip().endswith(pattern):
                completeness -= 0.3

        # 检查是否包含"等等"、"略"等不完整标记
        truncated_markers = ["等等", "略", "等", "以下"]
        for marker in truncated_markers:
            if marker in response:
                completeness -= 0.15

        # 检查是否包含拒绝回答的模式
        for unknown in self.UNKNOWN_PATTERNS:
            if unknown in response:
                completeness -= 0.25

        # 检查响应长度是否合理（相对于提示）
        prompt_length = len(prompt.strip())
        response_length = len(response.strip())

        if prompt_length > 50 and response_length < 20:
            completeness -= 0.3
        elif prompt_length > 100 and response_length < 50:
            completeness -= 0.2

        return max(0.0, min(1.0, completeness))

    def _check_confidence(self, response: str) -> float:
        """检查响应的置信度。

        低置信度特征：
        - 包含"可能"、"也许"等不确定词汇
        - 语气犹豫
        - 使用模糊表达
        """
        if not response:
            return 0.0

        confidence = 1.0

        # 检查低置信度词汇
        for pattern in self.LOW_CONFIDENCE_PATTERNS:
            if pattern in response:
                confidence -= 0.15

        # 检查是否多次出现不确定表达
        uncertain_count = sum(1 for p in self.LOW_CONFIDENCE_PATTERNS if p in response)
        if uncertain_count > 2:
            confidence -= 0.2

        return max(0.0, min(1.0, confidence))

    def _check_tool_success(
        self,
        response: str,
        context: Dict[str, Any],
    ) -> float:
        """检查工具调用是否成功。

        工具调用失败的特征：
        - 响应中包含工具失败相关模式
        - context 中包含错误信息
        """
        tool_success = 1.0

        # 检查响应中的失败模式
        for pattern in self.TOOL_FAILURE_PATTERNS:
            if pattern in response:
                tool_success -= 0.4

        # 检查 context 中的工具调用结果
        tool_result = context.get("tool_result")
        if tool_result is not None:
            if isinstance(tool_result, dict):
                if tool_result.get("error") or tool_result.get("success") is False:
                    tool_success -= 0.5
            elif isinstance(tool_result, str):
                if "error" in tool_result.lower() or "fail" in tool_result.lower():
                    tool_success -= 0.3

        # 检查 context 中是否有明确的工具调用失败标记
        if context.get("tool_called") and not tool_result:
            # 调用了工具但没有结果，视为失败
            tool_success -= 0.3

        return max(0.0, min(1.0, tool_success))
