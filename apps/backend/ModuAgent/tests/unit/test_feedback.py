"""反馈与质量模块功能测试：FeedbackLoop, QualityMonitor, AccuracyMetrics, EvolutionSignal。"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from feedback.loop_controller import FeedbackLoop
from feedback.quality_monitor import QualityMonitor
from feedback.evolution_signal import EvolutionSignal, EvolutionSignalCollector
from feedback.metrics.accuracy import AccuracyMetrics


# ======================================================================
# QualityMonitor 测试
# ======================================================================

class TestQualityMonitorRule:
    """QualityMonitor 规则模式测试。"""

    def setup_method(self):
        self.monitor = QualityMonitor(mode="rule")

    def test_mode_is_rule(self):
        assert self.monitor.mode == "rule"

    def test_empty_response_returns_zero(self):
        result = self.monitor.evaluate("hello", "", {})
        assert result["relevance"] == 0.0
        assert result["completeness"] == 0.0
        assert result["overall"] == 0.0

    def test_whitespace_response_returns_zero(self):
        result = self.monitor.evaluate("hello", "   ", {})
        assert result["relevance"] == 0.0

    def test_good_response_scores_high(self):
        result = self.monitor.evaluate(
            "What is the weather today?",
            "The weather today is sunny with a high of 25 degrees Celsius, low humidity, and light breeze from the west.",
            {},
        )
        assert result["relevance"] >= 0.3
        assert result["completeness"] >= 0.0
        assert result["confidence"] > 0.0
        assert 0.0 <= result["overall"] <= 1.0

    def test_unknown_pattern_reduces_score(self):
        result = self.monitor.evaluate(
            "What is the capital of France?",
            "I don't know the answer to that question, 无法回答您的问题。",
            {},
        )
        # 包含"无法回答"会扣分
        assert result["completeness"] < 1.0

    def test_low_confidence_patterns(self):
        result = self.monitor.evaluate(
            "Explain quantum physics",
            "可能这个问题比较复杂，也许我们需要从多个角度来分析。大概有一些关键概念需要理解。",
            {},
        )
        assert result["confidence"] < 1.0

    def test_tool_failure_in_context(self):
        result = self.monitor.evaluate(
            "Search for something",
            "I found some results",
            {"tool_result": {"error": "Connection refused"}, "tool_called": True},
        )
        assert result["tool_success"] < 1.0

    def test_tool_called_no_result(self):
        result = self.monitor.evaluate(
            "Search",
            "Results here",
            {"tool_called": True},
        )
        assert result["tool_success"] < 1.0

    def test_all_dimensions_in_result(self):
        result = self.monitor.evaluate("prompt", "response", {})
        for key in ["relevance", "completeness", "confidence", "tool_success", "overall"]:
            assert key in result

    def test_short_response_relative_to_long_prompt(self):
        """长提示词 vs 短响应：completeness 应有扣分（实际逻辑是 if/elif）。"""
        # prompt_len > 50 and response_len < 20 -> -0.3 (if分支优先)
        long_prompt = "请详细分析" + "A" * 200
        result = self.monitor.evaluate(
            long_prompt,
            "OK",
            {},
        )
        # completeness = 1.0 - 0.3 = 0.7 (elif 不触发因为 if 已匹配)
        assert result["completeness"] == 0.7

    def test_response_ending_with_question_mark(self):
        result = self.monitor.evaluate(
            "Tell me about AI",
            "AI is artificial intelligence, but I'm not sure if that answers your question?",
            {},
        )
        assert result["completeness"] < 1.0

    def test_truncated_markers_in_response(self):
        """测试中文截断标记（"等等"、"等"、"略"、"以下"）。"""
        result = self.monitor.evaluate(
            "List all countries",
            "有中国、美国、印度、日本等等国家",
            {},
        )
        # 包含"等等"或"等"会被扣分
        assert result["completeness"] < 1.0

    def test_tool_failure_string_in_context(self):
        result = self.monitor.evaluate(
            "Search",
            "Here are results",
            {"tool_result": "Error: something failed"},
        )
        assert result["tool_success"] < 1.0

    def test_tool_success_with_false_in_context(self):
        result = self.monitor.evaluate(
            "Search",
            "Results",
            {"tool_result": {"success": False}},
        )
        assert result["tool_success"] < 1.0


class TestQualityMonitorLLMFallback:
    """QualityMonitor LLM/hybrid 模式 fallback 测试。"""

    def test_llm_mode_no_evaluator_falls_back(self):
        monitor = QualityMonitor(mode="llm", evaluator_llm=None)
        assert monitor.mode == "rule"  # 自动降级为 rule

    def test_hybrid_mode_no_evaluator_falls_back(self):
        monitor = QualityMonitor(mode="hybrid", evaluator_llm=None)
        assert monitor.mode == "rule"

    def test_unknown_mode_falls_back(self):
        monitor = QualityMonitor(mode="unknown_mode")
        assert monitor.mode == "rule"


class TestQualityMonitorParse:
    """QualityMonitor _parse_judge_response 测试。"""

    def setup_method(self):
        self.monitor = QualityMonitor(mode="rule")

    def test_parse_valid_json(self):
        import json
        content = json.dumps({
            "relevance": 0.85,
            "completeness": 0.80,
            "accuracy": 0.90,
            "confidence": 0.85,
            "tool_success": 1.0,
            "overall": 0.87,
        })
        result = self.monitor._parse_judge_response(content)
        assert result["relevance"] == 0.85
        assert result["accuracy"] == 0.90

    def test_parse_json_in_code_block(self):
        content = '```json\n{"relevance":0.9,"completeness":0.8,"accuracy":0.85,"confidence":0.9,"tool_success":1.0,"overall":0.89}\n```'
        result = self.monitor._parse_judge_response(content)
        assert result["relevance"] == 0.9

    def test_parse_empty_content(self):
        assert self.monitor._parse_judge_response("") is None

    def test_parse_invalid_json(self):
        assert self.monitor._parse_judge_response("not json at all") is None

    def test_parse_clamping_values(self):
        import json
        content = json.dumps({"relevance": 2.5, "completeness": -0.5, "accuracy": 0.8, "confidence": 0.8, "tool_success": 0.5})
        result = self.monitor._parse_judge_response(content)
        assert result["relevance"] == 1.0  # 钳制到 1.0
        assert result["completeness"] == 0.0  # 钳制到 0.0

    def test_parse_missing_overall_computed(self):
        import json
        content = json.dumps({"relevance": 0.8, "completeness": 0.8, "accuracy": 0.8, "confidence": 0.8, "tool_success": 0.8})
        result = self.monitor._parse_judge_response(content)
        assert 0.0 <= result["overall"] <= 1.0
        assert "overall" in result


class TestQualityMonitorBlend:
    """hybrid 模式加权融合测试。"""

    def setup_method(self):
        self.monitor = QualityMonitor(mode="rule")

    def test_blend_with_default_weights(self):
        rule = {"relevance": 0.9, "completeness": 0.8, "confidence": 0.7, "tool_success": 1.0}
        llm = {"relevance": 0.7, "completeness": 0.6, "confidence": 0.5, "tool_success": 0.8, "accuracy": 0.75}
        result = self.monitor._blend_results(rule, llm)
        assert "accuracy" in result
        assert 0.0 <= result["overall"] <= 1.0

    def test_blend_zero_weights(self):
        monitor = QualityMonitor(mode="rule", hybrid_rule_weight=0, hybrid_llm_weight=0)
        rule = {"relevance": 0.9, "completeness": 0.8, "confidence": 0.7, "tool_success": 1.0}
        llm = {"relevance": 0.5, "completeness": 0.5, "confidence": 0.5, "tool_success": 0.5, "accuracy": 0.5}
        result = monitor._blend_results(rule, llm)
        assert "overall" in result


# ======================================================================
# AccuracyMetrics 测试
# ======================================================================

class TestAccuracyMetrics:
    def test_empty_results(self):
        acc = AccuracyMetrics()
        result = acc.calculate([])
        assert result["success_rate"] == 0.0
        assert result["error_rate"] == 0.0
        assert result["avg_time"] == 0.0

    def test_all_success(self):
        acc = AccuracyMetrics()
        results = [
            {"success": True, "execution_time": 0.1},
            {"success": True, "execution_time": 0.2},
            {"success": True, "execution_time": 0.3},
        ]
        result = acc.calculate(results)
        assert result["success_rate"] == 1.0
        assert result["error_rate"] == 0.0
        assert abs(result["avg_time"] - 0.2) < 0.01

    def test_all_errors(self):
        acc = AccuracyMetrics()
        results = [
            {"success": False},
            {"success": False},
        ]
        result = acc.calculate(results)
        assert result["success_rate"] == 0.0
        assert result["error_rate"] == 1.0

    def test_mixed_results(self):
        acc = AccuracyMetrics()
        results = [
            {"success": True, "execution_time": 0.5},
            {"success": False},
            {"success": True, "execution_time": 1.5},
            {"success": False},
        ]
        result = acc.calculate(results)
        assert result["success_rate"] == 0.5
        assert result["error_rate"] == 0.5
        # avg_time = total_time / len(results) = (0.5 + 1.5) / 4 = 0.5
        assert result["avg_time"] == 0.5

    def test_no_success_key(self):
        acc = AccuracyMetrics()
        results = [{"other_field": "x"}]
        result = acc.calculate(results)
        assert result["success_rate"] == 0.0


# ======================================================================
# FeedbackLoop 测试
# ======================================================================

class TestFeedbackLoop:
    def setup_method(self):
        self.loop = FeedbackLoop(min_sample_size=3)

    def test_evaluate_returns_all_dimensions(self):
        import asyncio

        async def run():
            output = {"response": "A test response about Python programming"}
            context = {"prompt": "Tell me about Python"}
            result = await self.loop.evaluate(output, context)
            for key in ["relevance", "completeness", "accuracy", "tool_effectiveness", "quality_score"]:
                assert key in result
            return result

        result = asyncio.run(run())
        assert 0.0 <= result["quality_score"] <= 1.0

    def test_evaluate_with_empty_response(self):
        import asyncio

        async def run():
            output = {"response": ""}
            context = {"prompt": ""}
            return await self.loop.evaluate(output, context)

        result = asyncio.run(run())
        assert result["quality_score"] == 0.0

    def test_should_evolve_insufficient_samples(self):
        # 仅 1 个样本，不应触发进化
        self.loop._sample_count = 1
        result = self.loop.should_evolve({"quality_score": 0.3}, threshold=0.6)
        assert result is False

    def test_should_evolve_sufficient_samples_low_quality(self):
        # 显式设置累积指标中最后 3 个质量分都低于阈值
        self.loop._sample_count = 3
        self.loop._cumulative_metrics = {"quality_score": [0.3, 0.4, 0.3]}
        result = self.loop.should_evolve({"quality_score": 0.3}, threshold=0.6)
        assert result is True

    def test_should_evolve_sufficient_samples_high_quality(self):
        self.loop._sample_count = 3
        self.loop._cumulative_metrics = {"quality_score": [0.9, 0.8, 0.9]}
        result = self.loop.should_evolve({"quality_score": 0.9}, threshold=0.6)
        assert result is False

    def test_should_evolve_below_ratio_threshold(self):
        # 只有 33% < 阈值，不满足 60%
        self.loop._sample_count = 3
        self.loop._cumulative_metrics = {"quality_score": [0.3, 0.9, 0.9]}
        result = self.loop.should_evolve({"quality_score": 0.3}, threshold=0.6)
        assert result is False

    def test_get_cumulative_metrics(self):
        self.loop._sample_count = 2
        self.loop._cumulative_metrics = {
            "relevance": [0.8, 0.9],
            "quality_score": [0.7, 0.8],
        }
        metrics = self.loop.get_cumulative_metrics()
        assert abs(metrics["relevance_avg"] - 0.85) < 0.0001
        assert metrics["relevance_latest"] == 0.9
        assert metrics["quality_score_latest"] == 0.8

    def test_get_cumulative_metrics_empty(self):
        assert self.loop.get_cumulative_metrics() == {}

    def test_get_sample_count(self):
        assert self.loop.get_sample_count() == 0
        self.loop._sample_count = 5
        assert self.loop.get_sample_count() == 5

    def test_reset(self):
        self.loop._sample_count = 10
        self.loop._cumulative_metrics = {"quality_score": [0.5]}
        self.loop.reset()
        assert self.loop.get_sample_count() == 0
        assert self.loop.get_cumulative_metrics() == {}

    def test_accumulate_sample_increments_count(self):
        self.loop._accumulate_sample({"relevance": 0.5, "quality_score": 0.7})
        assert self.loop._sample_count == 1
        assert self.loop._cumulative_metrics["quality_score"] == [0.7]

    def test_evaluate_with_low_relevance_accumulates_correctly(self):
        import asyncio

        async def run():
            output = {"response": "Python is a programming language"}
            context = {"prompt": "What is the weather today?"}
            return await self.loop.evaluate(output, context)

        result = asyncio.run(run())
        assert self.loop._sample_count == 1


# ======================================================================
# EvolutionSignal 测试
# ======================================================================

class TestEvolutionSignal:
    def test_dataclass_fields(self):
        sig = EvolutionSignal(
            signal_type="test",
            source="feedback",
            timestamp=12345.0,
            metrics={"score": 0.5},
            context={"detail": "test"},
            severity="high",
        )
        assert sig.signal_type == "test"
        assert sig.severity == "high"


class TestEvolutionSignalCollector:
    def setup_method(self):
        self.collector = EvolutionSignalCollector(report_interval=3)

    def test_on_agent_event_none_skipped(self):
        self.collector.on_agent_event(None)
        assert len(self.collector.get_signals()) == 0

    def test_on_agent_event_no_signal_on_first(self, monkeypatch):
        """前 `report_interval - 1` 次事件不应生成信号。"""
        from unittest.mock import MagicMock
        fake_event = MagicMock()
        fake_event.domain = "test"
        fake_event.action = "run"
        fake_event.priority.value = "normal"
        fake_event.event_id = "e1"
        fake_event.trace_id = "t1"
        fake_event.session_id = "s1"
        fake_event.metadata = {}

        self.collector.on_agent_event(fake_event)
        self.collector.on_agent_event(fake_event)
        assert len(self.collector.get_signals()) == 0

    def test_on_agent_event_creates_signal_at_interval(self, monkeypatch):
        from unittest.mock import MagicMock
        fake_event = MagicMock()
        fake_event.domain = "test"
        fake_event.action = "run"
        fake_event.priority.value = "normal"
        fake_event.event_id = "e1"
        fake_event.trace_id = "t1"
        fake_event.session_id = "s1"
        fake_event.metadata = {}

        for _ in range(3):
            self.collector.on_agent_event(fake_event)
        assert len(self.collector.get_signals()) == 1

    def test_severity_mapping(self, monkeypatch):
        from unittest.mock import MagicMock

        def make_event(priority):
            e = MagicMock()
            e.domain = "d"
            e.action = "a"
            e.priority.value = priority
            e.event_id = "e"
            e.trace_id = "t"
            e.session_id = "s"
            e.metadata = {}
            return e

        collector = EvolutionSignalCollector(report_interval=1)
        collector.on_agent_event(make_event("low"))
        assert collector.get_signals()[0].severity == "low"

        collector2 = EvolutionSignalCollector(report_interval=1)
        collector2.on_agent_event(make_event("critical"))
        assert collector2.get_signals()[0].severity == "high"
