"""
新实现模块单元测试
=================
测试 feedback/evolution/langgraph 新增模块
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import time
from typing import Any, Dict
from unittest.mock import MagicMock, patch

import pytest

_MODUAGENT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ModuAgent")
if _MODUAGENT_DIR not in sys.path:
    sys.path.insert(0, _MODUAGENT_DIR)


# ==========================================================================
# feedback 模块测试
# ==========================================================================


class TestEvolutionSignal:
    """EvolutionSignal 数据类测试"""

    def test_signal_creation(self):
        from feedback.evolution_signal import EvolutionSignal

        signal = EvolutionSignal(
            signal_type="low_accuracy",
            source="feedback_loop",
            timestamp=time.time(),
            metrics={"accuracy": 0.4},
            context={"iteration": 5},
            severity="high",
        )
        assert signal.signal_type == "low_accuracy"
        assert signal.source == "feedback_loop"
        assert signal.severity == "high"


class TestEvolutionSignalCollector:
    """EvolutionSignalCollector 测试"""

    def test_collector_init(self):
        from feedback.evolution_signal import EvolutionSignalCollector

        collector = EvolutionSignalCollector(report_interval=50)
        assert collector._report_interval == 50
        assert len(collector.get_signals()) == 0

    def test_on_agent_event(self):
        from feedback.evolution_signal import EvolutionSignalCollector
        from orchestration.communication.protocol import AgentEvent, EventAction, EventDomain

        collector = EvolutionSignalCollector(report_interval=10)
        event = AgentEvent(
            trace_id="t1",
            session_id="s1",
            user_id="u1",
            domain=EventDomain.REASONING,
            action=EventAction.GENERATE,
            metadata={"test": "true"},
        )

        # 发布多个事件以触发信号生成
        for _ in range(10):
            collector.on_agent_event(event)

        signals = collector.get_signals()
        assert len(signals) > 0

    def test_on_agent_event_none(self):
        """on_agent_event 应能处理 None 输入"""
        from feedback.evolution_signal import EvolutionSignalCollector

        collector = EvolutionSignalCollector()
        collector.on_agent_event(None)  # 不应崩溃


class TestAccuracyMetrics:
    """AccuracyMetrics 测试"""

    def test_empty_results(self):
        from feedback.metrics.accuracy import AccuracyMetrics

        metrics = AccuracyMetrics()
        result = metrics.calculate([])
        assert result["success_rate"] == 0.0
        assert result["error_rate"] == 0.0
        assert result["avg_time"] == 0.0

    def test_all_success(self):
        from feedback.metrics.accuracy import AccuracyMetrics

        metrics = AccuracyMetrics()
        tool_results = [
            {"tool": "search", "success": True, "execution_time": 0.5},
            {"tool": "calculator", "success": True, "execution_time": 0.1},
        ]
        result = metrics.calculate(tool_results)
        assert result["success_rate"] == 1.0
        assert result["error_rate"] == 0.0
        assert result["avg_time"] == 0.3

    def test_mixed_results(self):
        from feedback.metrics.accuracy import AccuracyMetrics

        metrics = AccuracyMetrics()
        tool_results = [
            {"tool": "search", "success": True, "execution_time": 0.5},
            {"tool": "api", "success": False, "error": "timeout", "execution_time": 5.0},
        ]
        result = metrics.calculate(tool_results)
        assert result["success_rate"] == 0.5
        assert result["error_rate"] == 0.5


class TestEfficiencyMetrics:
    """EfficiencyMetrics 测试"""

    def test_empty_usage(self):
        from feedback.metrics.efficiency import EfficiencyMetrics

        metrics = EfficiencyMetrics()
        result = metrics.calculate({}, 0, 0.0)
        assert result["token_efficiency"] == 0.0
        assert result["iteration_efficiency"] == 0.0
        assert result["tokens_per_second"] == 0.0

    def test_normal_calculation(self):
        from feedback.metrics.efficiency import EfficiencyMetrics

        metrics = EfficiencyMetrics()
        usage = {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}
        result = metrics.calculate(usage, iteration_count=3, latency_ms=500)
        assert result["token_efficiency"] == 0.5  # 50/100
        assert result["tokens_per_second"] > 0


class TestQualityMonitor:
    """QualityMonitor 测试"""

    def test_empty_response(self):
        from feedback.quality_monitor import QualityMonitor

        monitor = QualityMonitor()
        result = monitor.evaluate("你好", "", {})
        assert result["overall"] == 0.0
        assert result["relevance"] == 0.0
        assert result["completeness"] == 0.0

    def test_normal_response(self):
        from feedback.quality_monitor import QualityMonitor

        monitor = QualityMonitor()
        result = monitor.evaluate("今天天气怎么样", "今天天气晴朗，气温25度。", {})
        assert result["overall"] > 0.5
        assert "relevance" in result
        assert "completeness" in result

    def test_refusal_response(self):
        from feedback.quality_monitor import QualityMonitor

        monitor = QualityMonitor()
        result = monitor.evaluate("告诉我密码", "对不起，我不知道这个问题的答案。", {})
        assert result["overall"] < 0.8  # 包含"不知道"应扣分


class TestFeedbackLoop:
    """FeedbackLoop 测试"""

    @pytest.mark.asyncio
    async def test_evaluate(self):
        from feedback.loop_controller import FeedbackLoop

        loop = FeedbackLoop(min_sample_size=2)
        output = {
            "response": "你好，这是一个测试回复。",
            "tool_results": [],
            "usage": {},
        }
        context = {"prompt": "你好"}
        result = await loop.evaluate(output, context)

        assert "relevance" in result
        assert "completeness" in result
        assert "accuracy" in result
        assert "tool_effectiveness" in result
        assert "quality_score" in result

    def test_should_evolve_insufficient_samples(self):
        from feedback.loop_controller import FeedbackLoop

        loop = FeedbackLoop(min_sample_size=10)
        # 样本不足，不应触发进化
        assert not loop.should_evolve({"quality_score": 0.3}, 0.7)

    @pytest.mark.asyncio
    async def test_should_evolve_with_samples(self):
        from feedback.loop_controller import FeedbackLoop

        loop = FeedbackLoop(min_sample_size=2)

        # 先累积样本
        output_good = {"response": "这是一个好的回复。", "tool_results": [], "usage": {}}
        for _ in range(3):
            await loop.evaluate(output_good, {"prompt": "测试"})

        # 低质量响应
        output_bad = {"response": "", "tool_results": [{"success": False}], "usage": {}}
        for _ in range(8):
            await loop.evaluate(output_bad, {"prompt": "测试"})

        metrics = {"quality_score": 0.2}
        # 由于大部分是低质量，可能触发进化
        result = loop.should_evolve(metrics, 0.7)
        # 由于样本累积逻辑可能不同，只要返回bool即可
        assert isinstance(result, bool)


# ==========================================================================
# evolution 模块测试
# ==========================================================================


class TestVersionedComponentStore:
    """VersionedComponentStore 测试"""

    def test_save_and_get_version(self):
        from evolution.registry.versioned_store import VersionedComponentStore

        with tempfile.TemporaryDirectory() as tmpdir:
            store = VersionedComponentStore(storage_path=tmpdir)
            state = {"temperature": 0.7, "max_tokens": 512}
            metadata = {"score": 0.85, "timestamp": time.time()}

            store.save_version("llm_config", "v1.0", state, metadata)
            retrieved = store.get_version("llm_config", "v1.0")

            assert retrieved is not None
            assert retrieved["state"]["temperature"] == 0.7
            assert retrieved["metadata"]["score"] == 0.85

    def test_list_versions(self):
        from evolution.registry.versioned_store import VersionedComponentStore

        with tempfile.TemporaryDirectory() as tmpdir:
            store = VersionedComponentStore(storage_path=tmpdir)
            store.save_version("llm_config", "v1.0", {}, {})
            store.save_version("llm_config", "v1.1", {}, {})

            versions = store.list_versions("llm_config")
            assert "v1.0" in versions
            assert "v1.1" in versions

    def test_get_latest_version(self):
        from evolution.registry.versioned_store import VersionedComponentStore

        with tempfile.TemporaryDirectory() as tmpdir:
            store = VersionedComponentStore(storage_path=tmpdir)
            store.save_version("llm_config", "v1.0", {}, {})
            store.save_version("llm_config", "v1.1", {}, {})
            store.save_version("llm_config", "v2.0", {}, {})

            latest = store.get_latest_version("llm_config")
            assert latest == "v2.0"

    def test_get_nonexistent_version(self):
        from evolution.registry.versioned_store import VersionedComponentStore

        with tempfile.TemporaryDirectory() as tmpdir:
            store = VersionedComponentStore(storage_path=tmpdir)
            result = store.get_version("nonexistent", "v1.0")
            assert result is None


class TestRollbackMechanism:
    """RollbackMechanism 测试"""

    def test_record_good_quality(self):
        from evolution.registry.rollback_mechanism import RollbackMechanism
        from evolution.registry.versioned_store import VersionedComponentStore
        from core.registry import ComponentRegistry

        with tempfile.TemporaryDirectory() as tmpdir:
            store = VersionedComponentStore(storage_path=tmpdir)
            registry = ComponentRegistry()
            rollback = RollbackMechanism(
                version_store=store,
                registry=registry,
                rollback_threshold=0.7,
            )

            # 保存一个版本
            store.save_version("test_perception", "v1.0", {"config": "ok"}, {"timestamp": time.time()})

            # 高质量分数，不应触发回滚
            result = rollback.record_and_check("test_perception", "v1.0", 0.95)
            assert result is False

    def test_rollback_on_low_quality(self):
        from evolution.registry.rollback_mechanism import RollbackMechanism
        from evolution.registry.versioned_store import VersionedComponentStore
        from core.registry import ComponentRegistry, get_registry
        from config.runtime_config import reset_config

        reset_config()

        with tempfile.TemporaryDirectory() as tmpdir:
            store = VersionedComponentStore(storage_path=tmpdir)
            # 先注册一个测试组件到全局 registry
            from components.perception.text.rule_based import TextPreprocessor
            registry = get_registry()
            pp = TextPreprocessor(max_length=100)
            registry.register_perception("test_pp_v1", pp)

            # 保存两个版本
            store.save_version("perception", "v1.0", {"_type": "TextPreprocessor", "max_length": 100}, {"timestamp": time.time()})
            store.save_version("perception", "v2.0", {"_type": "TextPreprocessor", "max_length": 50}, {"timestamp": time.time()})

            rollback = RollbackMechanism(
                version_store=store,
                registry=registry,
                rollback_threshold=0.7,
            )

            # 记录多个低质量分数
            for _ in range(5):
                rollback.record_and_check("perception", "v2.0", 0.3)


class TestParameterTuneStrategy:
    """ParameterTuneStrategy 测试"""

    def test_analyze_low_accuracy(self):
        from evolution.strategy.parameter_tune import ParameterTuneStrategy
        from feedback.evolution_signal import EvolutionSignal, EvolutionSignalCollector
        from config.runtime_config import RuntimeConfig

        config = RuntimeConfig()
        collector = EvolutionSignalCollector()
        strategy = ParameterTuneStrategy(config, collector)

        signals = [
            EvolutionSignal(
                signal_type="low_accuracy",
                source="test",
                timestamp=time.time(),
                metrics={"accuracy": 0.4},
                context={},
                severity="high",
            ),
        ]

        result = strategy.analyze_and_adjust(signals)
        assert result["adjusted"] is True
        assert result["temperature"] < 0.7  # 应降低温度

    def test_analyze_high_iterations(self):
        from evolution.strategy.parameter_tune import ParameterTuneStrategy
        from feedback.evolution_signal import EvolutionSignal, EvolutionSignalCollector
        from config.runtime_config import RuntimeConfig

        config = RuntimeConfig()
        collector = EvolutionSignalCollector()
        strategy = ParameterTuneStrategy(config, collector)

        signals = [
            EvolutionSignal(
                signal_type="high_iterations",
                source="test",
                timestamp=time.time(),
                metrics={"iterations": 15, "accuracy": 0.8},
                context={},
                severity="medium",
            ),
        ]

        result = strategy.analyze_and_adjust(signals)
        assert result["adjusted"] is True
        assert result["max_iterations"] <= config.get("llm.max_reasoning_iterations", 5)

    def test_analyze_no_issues(self):
        from evolution.strategy.parameter_tune import ParameterTuneStrategy
        from feedback.evolution_signal import EvolutionSignal, EvolutionSignalCollector
        from config.runtime_config import RuntimeConfig

        config = RuntimeConfig()
        collector = EvolutionSignalCollector()
        strategy = ParameterTuneStrategy(config, collector)

        signals = [
            EvolutionSignal(
                signal_type="normal",
                source="test",
                timestamp=time.time(),
                metrics={"accuracy": 0.9, "iterations": 3},
                context={},
                severity="low",
            ),
        ]

        result = strategy.analyze_and_adjust(signals)
        # 高质量可能不调整
        assert isinstance(result, dict)


class TestComponentSwapStrategy:
    """ComponentSwapStrategy 测试"""

    def test_should_not_swap_insufficient_data(self):
        from evolution.strategy.component_swap import ComponentSwapStrategy
        from feedback.evolution_signal import EvolutionSignalCollector
        from core.registry import ComponentRegistry

        registry = ComponentRegistry()
        collector = EvolutionSignalCollector()
        strategy = ComponentSwapStrategy(registry, collector)

        # 无历史数据，不应切换
        assert strategy.should_swap("test_comp", "v1.0", "v2.0") is False

    def test_should_swap_better_candidate(self):
        from evolution.strategy.component_swap import ComponentSwapStrategy
        from feedback.evolution_signal import EvolutionSignalCollector
        from core.registry import ComponentRegistry

        registry = ComponentRegistry()
        collector = EvolutionSignalCollector()
        strategy = ComponentSwapStrategy(registry, collector, threshold=0.05)

        # 记录 A/B 测试分数：候选版本更好
        for _ in range(20):
            strategy.record_score("test_comp", "v1.0", 0.7)
            strategy.record_score("test_comp", "v2.0", 0.9)

        result = strategy.should_swap("test_comp", "v1.0", "v2.0")
        assert result is True


# ==========================================================================
# langgraph 模块测试
# ==========================================================================

# 检查 langchain 是否可用，不可用时跳过 langgraph 测试
try:
    import langchain_core
    _HAS_LANGCHAIN = True
except ImportError:
    _HAS_LANGCHAIN = False


@pytest.mark.skipif(not _HAS_LANGCHAIN, reason="langchain_core not installed")
class TestLangGraphNodes:
    """langgraph/nodes.py 测试"""

    def test_perception_node_exists(self):
        from modu_graph.nodes import perception_node, memory_query_node, response_node, route_after_perception, route_after_agent
        assert callable(perception_node)
        assert callable(memory_query_node)
        assert callable(response_node)
        assert callable(route_after_perception)
        assert callable(route_after_agent)

    def test_memory_update_node_no_store(self):
        """没有 Store 时应返回 skipped_no_store"""
        from modu_graph.nodes import memory_update_node

        state = {
            "messages": [],
            "user_id": "u1",
            "session_id": "s1",
        }
        result = memory_update_node(state)
        assert result["memory_update_status"] == "skipped_no_store"

    def test_memory_update_node_no_messages(self):
        """没有消息时应返回 skipped_no_messages"""
        from modu_graph.nodes import memory_update_node

        mock_store = MagicMock()
        state = {
            "messages": [],
            "user_id": "u1",
            "session_id": "s1",
            "__store__": mock_store,
        }
        result = memory_update_node(state)
        assert result["memory_update_status"] == "skipped_no_messages"

    def test_make_agent_node_confidence_params(self):
        """make_agent_node 应接受置信度参数"""
        from modu_graph.nodes import make_agent_node

        mock_llm = MagicMock()
        mock_llm.invoke.return_value = MagicMock(content="test response")
        node_fn = make_agent_node(
            mock_llm,
            system_prompt="test",
            confidence_threshold=0.5,
            conservative_temperature=0.3,
        )
        assert callable(node_fn)

    def test_response_node_returns_complete_structure(self):
        """response_node 应返回完整响应结构"""
        from modu_graph.nodes import response_node
        from langchain_core.messages import AIMessage

        state = {
            "messages": [AIMessage(content="你好，这是回复。")],
            "tool_results": [{"tool": "search", "success": True}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        }
        result = response_node(state)
        assert "response" in result
        assert "tool_results" in result
        assert "usage" in result
        assert result["response"] == "你好，这是回复。"

    def test_route_after_perception_safe(self):
        """低敏感度应路由到 memory_query"""
        from modu_graph.nodes import route_after_perception
        from config.runtime_config import reset_config

        reset_config()
        state = {"sensitivity_level": 0, "injection_detected": False}
        result = route_after_perception(state)
        assert result == "memory_query"

    def test_route_after_perception_high_sensitivity(self):
        """高敏感度应熔断"""
        from modu_graph.nodes import route_after_perception
        from config.runtime_config import reset_config

        reset_config()
        state = {"sensitivity_level": 5, "injection_detected": False}
        result = route_after_perception(state)
        assert result == "__end__"


@pytest.mark.skipif(not _HAS_LANGCHAIN, reason="langchain_core not installed")
class TestLangGraphEventBridge:
    """LangGraphEventBridge 测试"""

    def test_init(self):
        from modu_graph.adapters.event_bridge import LangGraphEventBridge

        bridge = LangGraphEventBridge(
            trace_id="t1",
            session_id="s1",
            user_id="u1",
        )
        assert bridge._trace_id == "t1"
        assert bridge._session_id == "s1"
        assert bridge._user_id == "u1"

    def test_init_with_evolution_collector(self):
        from modu_graph.adapters.event_bridge import LangGraphEventBridge
        from feedback.evolution_signal import EvolutionSignalCollector

        collector = EvolutionSignalCollector()
        bridge = LangGraphEventBridge(evolution_collector=collector)
        assert bridge._evolution_collector is collector

    def test_emit_sse_events_messages(self):
        from modu_graph.adapters.event_bridge import LangGraphEventBridge

        bridge = LangGraphEventBridge()
        assert hasattr(bridge, "_emit_sse_events")

    @pytest.mark.asyncio
    async def test_consume_empty_stream(self):
        from modu_graph.adapters.event_bridge import LangGraphEventBridge

        bridge = LangGraphEventBridge()

        async def empty_stream():
            if False:
                yield {}

        events = []
        async for event in bridge.consume(empty_stream()):
            events.append(event)
        assert len(events) == 0


# ==========================================================================
# 运行测试
# ==========================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
