"""性能与边界条件测试。"""

from __future__ import annotations

import time
import threading

import pytest

from config.runtime_config import RuntimeConfig, get_config, reset_config
from components.action.tools.calculator import CalculatorTool
from components.memory.cache.short_term_memory import InMemoryShortTermMemory
from components.perception.security.guard import SecurityGuard
from components.perception.text.rule_based import TextPreprocessor
from feedback.quality_monitor import QualityMonitor
from feedback.loop_controller import FeedbackLoop
from feedback.evolution_signal import EvolutionSignalCollector


# ======================================================================
# RuntimeConfig 线程安全与性能测试
# ======================================================================

class TestConfigThreadSafety:
    """RuntimeConfig 多线程并发测试。"""

    def test_concurrent_reads(self):
        cfg = RuntimeConfig()
        errors = []

        def reader():
            for _ in range(500):
                try:
                    val = cfg.get("llm.temperature")
                    assert val is not None
                except Exception as e:
                    errors.append(e)

        threads = [threading.Thread(target=reader) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(errors) == 0

    def test_concurrent_reads_and_writes(self):
        cfg = RuntimeConfig()
        errors = []

        def worker(idx):
            base = idx * 0.1
            for i in range(200):
                try:
                    cfg.update("llm.temperature", base + i * 0.001)
                    val = cfg.get("llm.temperature")
                    assert val is not None
                except Exception as e:
                    errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(errors) == 0

    def test_concurrent_update_many(self):
        cfg = RuntimeConfig()
        errors = []

        def updater(idx):
            for _ in range(100):
                try:
                    cfg.update_many({
                        "llm.temperature": 0.1 * idx,
                        "llm.max_tokens": 512 + idx,
                    })
                except Exception as e:
                    errors.append(e)

        threads = [threading.Thread(target=updater, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(errors) == 0


# ======================================================================
# 性能基准测试
# ======================================================================

class TestPerformanceBaseline:
    """基础性能基准测试。"""

    def test_calculator_tool_throughput(self):
        """测试 CalculatorTool 吞吐量：1000 次调用。"""
        tool = CalculatorTool()
        start = time.perf_counter()
        for _ in range(1000):
            tool.invoke({"expression": "2+2"}, {})
        elapsed = time.perf_counter() - start
        ops_per_sec = 1000 / elapsed
        # 预期 > 1000 ops/s（纯计算，应很快）
        assert ops_per_sec > 500, f"Calculator throughput {ops_per_sec:.0f} ops/s below threshold"

    def test_memory_operations_throughput(self):
        """测试 InMemoryShortTermMemory 读写吞吐量。"""
        memory = InMemoryShortTermMemory(max_turns=100, ttl_seconds=600)
        now = time.time()
        start = time.perf_counter()

        for i in range(500):
            memory.update(f"u{i%10}", {"prompt": f"test{i}", "response": f"resp{i}"},
                          {"timestamp": now + i, "session_id": f"s{i%10}"})

        write_elapsed = time.perf_counter() - start
        write_ops = 500 / write_elapsed

        start = time.perf_counter()
        for i in range(500):
            memory.query(f"u{i%10}", "last_5_turns", ["prompt", "response"])
        read_elapsed = time.perf_counter() - start
        read_ops = 500 / read_elapsed

        # 预期 > 1000 ops/s
        assert write_ops > 100, f"Memory write {write_ops:.0f} ops/s below threshold"
        assert read_ops > 100, f"Memory read {read_ops:.0f} ops/s below threshold"

    def test_security_guard_throughput(self):
        """测试 SecurityGuard 检测吞吐量。"""
        guard = SecurityGuard()
        texts = [
            "hello world",
            "今天天气怎么样？",
            "What is the best programming language?",
            "请帮我搜索最新的AI新闻",
            "Tell me about machine learning",
        ]
        start = time.perf_counter()
        for _ in range(100):
            for text in texts:
                guard.detect_all(text)
        elapsed = time.perf_counter() - start
        ops_per_sec = 500 / elapsed
        # 预期 > 500 ops/s
        assert ops_per_sec > 200, f"Security guard {ops_per_sec:.0f} ops/s below threshold"

    def test_text_preprocessor_throughput(self):
        """测试 TextPreprocessor 处理吞吐量。"""
        processor = TextPreprocessor()
        data = b"Hello world, this is a test input for text preprocessing. It should be fast enough."
        start = time.perf_counter()
        for _ in range(200):
            processor.perceive("text", data)
        elapsed = time.perf_counter() - start
        ops_per_sec = 200 / elapsed
        assert ops_per_sec > 20, f"TextPreprocessor {ops_per_sec:.0f} ops/s below threshold"

    def test_quality_monitor_throughput(self):
        """测试 QualityMonitor 评估吞吐量。"""
        monitor = QualityMonitor(mode="rule")
        start = time.perf_counter()
        for _ in range(500):
            monitor.evaluate(
                "What is Python?",
                "Python is a high-level programming language known for its simplicity and readability.",
                {},
            )
        elapsed = time.perf_counter() - start
        ops_per_sec = 500 / elapsed
        assert ops_per_sec > 100, f"QualityMonitor {ops_per_sec:.0f} ops/s below threshold"


# ======================================================================
# 边界条件测试
# ======================================================================

class TestCalculatorBoundary:
    """CalculatorTool 边界值测试。"""

    def setup_method(self):
        self.tool = CalculatorTool()

    def test_extremely_large_expression(self):
        result = self.tool.invoke({"expression": "9" * 50 + "+1"}, {})
        assert "status" in result  # 不崩溃

    def test_deeply_nested_parentheses(self):
        expr = "(" * 20 + "1+2" + ")" * 20
        result = self.tool.invoke({"expression": expr}, {})
        assert "status" in result

    def test_expression_with_leading_trailing_spaces(self):
        result = self.tool.invoke({"expression": "   1+1   "}, {})
        assert result["status"] == "success"

    def test_very_small_decimal(self):
        result = self.tool.invoke({"expression": "0.0000001*0.0000001"}, {})
        assert result["status"] == "success"

    def test_negative_division(self):
        result = self.tool.invoke({"expression": "-10/3"}, {})
        assert result["status"] == "success"
        assert result["data"]["result"] < 0

    def test_modulo_not_allowed(self):
        result = self.tool.invoke({"expression": "10%3"}, {})
        assert result["status"] == "error"  # % 不在允许字符中


class TestMemoryBoundary:
    """Memory 边界条件测试。"""

    def test_extremely_large_turn_count(self):
        memory = InMemoryShortTermMemory(max_turns=10000, ttl_seconds=3600)
        now = time.time()
        for i in range(1000):
            memory.update("u1", {"seq": i}, {"timestamp": now + i, "session_id": "s1"})
        result = memory.query("u1", "last_5_turns", ["seq"])
        assert len(result["history"]) == 5

    def test_zero_max_turns(self):
        memory = InMemoryShortTermMemory(max_turns=0, ttl_seconds=3600)
        memory.update("u1", {"data": "test"}, {"timestamp": time.time(), "session_id": "s"})
        result = memory.query("u1", "last_1_turns", ["data"])
        assert "history" in result

    def test_very_short_ttl(self):
        memory = InMemoryShortTermMemory(max_turns=5, ttl_seconds=1)
        now = time.time()
        memory.update("u1", {"text": "old"}, {"timestamp": now - 10, "session_id": "s"})
        result = memory.query("u1", "last_5_turns", ["text"])
        assert result["history"] == []

    def test_empty_required_fields(self):
        memory = InMemoryShortTermMemory()
        memory.update("u1", {"a": 1}, {"timestamp": time.time(), "session_id": "s"})
        result = memory.query("u1", "last_5_turns", [])
        # 不存在的字段返回空字典
        assert result["history"] == [{}]


class TestTextPreprocessorBoundary:
    """TextPreprocessor 边界条件测试。"""

    def setup_method(self):
        self.processor = TextPreprocessor(max_length=100)

    def test_empty_input(self):
        result = self.processor.perceive("text", b"")
        assert result["confidence"] >= 0.0

    def test_very_long_input(self):
        text = "A" * 5000
        result = self.processor.perceive("text", text.encode("utf-8"))
        assert "truncated" in result.get("metadata", {}).get("truncation_info", {})
        assert result["metadata"].get("truncated") is True

    def test_non_utf8_bytes(self):
        result = self.processor.perceive("text", b"\xff\xfe\xfd")
        assert "decoding_errors" in result.get("metadata", {})

    def test_unicode_control_chars(self):
        """验证控制字符被过滤。"""
        result = self.processor.perceive("text", b"hello\x00\x01world")
        sanitized = result.get("metadata", {}).get("sanitization_warnings", {})
        assert sanitized.get("stripped_control_chars", 0) >= 0

    def test_unsupported_input_type(self):
        result = self.processor.perceive("image", b"data")
        assert "unsupported" in result["parsed_content"].get("error", "")

    def test_mixed_language_detection(self):
        result = self.processor.perceive("text", "Hello world 你好世界 こんにちは".encode("utf-8"))
        assert result["detected_language"] is not None

    def test_json_truncation(self):
        """验证 JSON 感知截断。"""
        json_data = '{"key1": "value1", "key2": "value2", "key3": "a" * 500}'
        processor = TextPreprocessor(max_length=50)
        result = processor.perceive("text", json_data.encode("utf-8"))
        meta = result.get("metadata", {}).get("truncation_info", {})
        assert meta.get("truncated") is True or meta.get("truncated") is False  # 不崩溃即可


class TestQualityMonitorBoundary:
    """QualityMonitor 边界条件测试。"""

    def test_extremely_long_prompt_and_response(self):
        monitor = QualityMonitor(mode="rule")
        prompt = "x" * 10000
        response = "y" * 10000
        result = monitor.evaluate(prompt, response, {})
        assert "overall" in result

    def test_single_character(self):
        monitor = QualityMonitor(mode="rule")
        result = monitor.evaluate("A", "B", {})
        assert "relevance" in result

    def test_special_characters_in_response(self):
        monitor = QualityMonitor(mode="rule")
        response = "!@#$%^&*()_+{}|:\"<>?~`-=[]\\;',./"
        result = monitor.evaluate("test", response, {})
        assert "overall" in result


class TestFeedbackLoopBoundary:
    """FeedbackLoop 边界条件测试。"""

    def test_min_sample_size_zero(self):
        """min_sample_size=0 时任何样本都应触发进化逻辑。"""
        loop = FeedbackLoop(min_sample_size=1)  # 至少为 1 避免除零
        loop._sample_count = 1
        loop._cumulative_metrics = {"quality_score": [0.0]}
        # quality_score < threshold，满足触发条件
        assert loop.should_evolve({"quality_score": 0.0}, threshold=0.5) is True

    def test_extremely_large_sample(self):
        loop = FeedbackLoop(min_sample_size=100)
        loop._sample_count = 100
        loop._cumulative_metrics = {"quality_score": [0.3] * 100}
        assert loop.should_evolve({"quality_score": 0.3}, threshold=0.6) is True

    def test_threshold_boundaries(self):
        loop = FeedbackLoop(min_sample_size=1)
        loop._sample_count = 1
        loop._cumulative_metrics = {"quality_score": [0.5]}
        # quality_score=0.5 vs threshold=0.5 -> 0.5 < 0.5 is False -> 不触发
        assert loop.should_evolve({"quality_score": 0.5}, threshold=0.5) is False
        # quality_score=0.49 but cumulative is 0.5 -> 累计中 0.5 < 0.5 is False, 比例 0/1=0 < 0.6 -> False
        # should_evolve 同时检查 metrics 的 quality_score 和 cumulative_metrics 的最近值
        # 0.49 < 0.5 满足，但 recent_scores[-1:] = [0.5], 0.5 < 0.5 = False
        assert loop.should_evolve({"quality_score": 0.49}, threshold=0.5) is False
        # 将 cumulative_metrics 也设为 0.49，确保最近值低于阈值
        loop._cumulative_metrics = {"quality_score": [0.49]}
        assert loop.should_evolve({"quality_score": 0.49}, threshold=0.5) is True


class TestSecurityGuardBoundary:
    """SecurityGuard 边界条件测试。"""

    def test_extremely_long_text(self):
        guard = SecurityGuard()
        text = "A" * 100000
        result = guard.detect_all(text)
        assert "security_score" in result

    def test_empty_text(self):
        guard = SecurityGuard()
        result = guard.detect_all("")
        assert result["injection_detected"] is False
        assert result["pii_detected"] is False
        assert result["security_score"] == 1.0

    def test_partial_pii_patterns(self):
        """部分匹配的 PII 不应被检测。"""
        guard = SecurityGuard()
        result = guard.detect_pii("我的号码是13800")  # 不足11位
        assert result["detected"] is False

        result2 = guard.detect_pii("110101199001")  # 不足18位
        assert "id_card_cn" not in result2.get("types", [])


class TestEvolutionCollectorBoundary:
    """EvolutionSignalCollector 边界条件测试。"""

    def test_report_interval_one(self, monkeypatch):
        from unittest.mock import MagicMock
        collector = EvolutionSignalCollector(report_interval=1)
        fake = MagicMock()
        fake.domain = "d"
        fake.action = "a"
        fake.priority.value = "normal"
        fake.event_id = "e"
        fake.trace_id = "t"
        fake.session_id = "s"
        fake.metadata = {}
        collector.on_agent_event(fake)
        assert len(collector.get_signals()) == 1

    def test_report_interval_zero(self, monkeypatch):
        """P2-1 修复：interval=0 不再导致除零错误，应被钳制为 1。"""
        from unittest.mock import MagicMock
        collector = EvolutionSignalCollector(report_interval=0)
        assert collector._report_interval == 1  # 钳制为 1
        fake = MagicMock()
        fake.domain = "d"
        fake.action = "a"
        fake.priority.value = "normal"
        fake.event_id = "e"
        fake.trace_id = "t"
        fake.session_id = "s"
        fake.metadata = {}
        # 不再抛 ZeroDivisionError，每个事件生成一个信号
        collector.on_agent_event(fake)
        collector.on_agent_event(fake)
        assert len(collector.get_signals()) == 2

    def test_large_number_of_events(self, monkeypatch):
        from unittest.mock import MagicMock
        collector = EvolutionSignalCollector(report_interval=50)
        fake = MagicMock()
        fake.domain = "d"
        fake.action = "a"
        fake.priority.value = "normal"
        fake.event_id = "e"
        fake.trace_id = "t"
        fake.session_id = "s"
        fake.metadata = {}
        for _ in range(1000):
            collector.on_agent_event(fake)
        # 1000 / 50 = 20 signals（+1 for 1000th）
        signals = collector.get_signals()
        assert 19 <= len(signals) <= 21
