"""12.1 待修复问题验证测试。

覆盖 6 个待修复问题的功能验证：
- P1-6: should_evolve 双检不一致（B-001）
- P1-5: BaseLLMReasoner 默认值从 RuntimeConfig 读取
- P2-1: report_interval=0 除零（B-002）
- P2-3: deepseek 默认 model 笔误
- P2-9: MemoryQuerySchema.context_window 枚举约束（B-004）
- P2-8: get_active_reasoning_engine 依赖 dict 顺序
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from components.reasoning.llm.base_llm import BaseLLMReasoner
from components.reasoning.llm.deepseek import DeepSeekLLMReasoner, _DEFAULT_MODEL
from config.runtime_config import RuntimeConfig, override_config, reset_config
from config.schemas import (
    VALID_CONTEXT_WINDOWS,
    MemoryQuerySchema,
    _is_valid_context_window,
)
from core.interfaces.reasoning import BaseReasoningEngine
from core.registry import ComponentRegistry
from feedback.evolution_signal import EvolutionSignalCollector
from feedback.loop_controller import FeedbackLoop


# ======================================================================
# 辅助：可实例化的 BaseLLMReasoner 子类（基类已实现所有抽象方法）
# ======================================================================

class _ConcreteLLMReasoner(BaseLLMReasoner):
    """测试用最小可实例化 LLM 推理器。"""

    pass


def _make_mock_event(domain: str = "test", action: str = "run", priority: str = "normal"):
    """构造 EvolutionSignalCollector 所需的 mock AgentEvent。"""
    e = MagicMock()
    e.domain = domain
    e.action = action
    e.priority.value = priority
    e.event_id = "e1"
    e.trace_id = "t1"
    e.session_id = "s1"
    e.metadata = {}
    return e


class _MockReasoningEngine(BaseReasoningEngine):
    """测试用最小 BaseReasoningEngine 实现。"""

    def reason(self, prompt, context, **kwargs):
        return ("", {}, [])

    def stream(self, prompt, context, **kwargs):
        yield ""


# ======================================================================
# P1-6: should_evolve 双检不一致修复测试
# ======================================================================

class TestShouldEvolveConsistentDataSource:
    """P1-6: should_evolve 应统一使用内部累积状态，消除双检不一致。"""

    def test_ignores_passed_metrics_high_score_when_cumulative_low(self):
        """核心修复验证：传入高 quality_score 不再门控，决策基于累积状态。

        修复前：传入 quality_score=0.9 >= threshold → 门控不通过 → False
        修复后：忽略传入参数，累积全低 → True
        """
        loop = FeedbackLoop(min_sample_size=3)
        loop._sample_count = 3
        loop._cumulative_metrics = {"quality_score": [0.2, 0.3, 0.2]}
        result = loop.should_evolve({"quality_score": 0.9}, threshold=0.6)
        assert result is True

    def test_ignores_passed_metrics_low_score_when_cumulative_high(self):
        """传入低 quality_score 但累积全高 → 不触发（基于累积）。"""
        loop = FeedbackLoop(min_sample_size=3)
        loop._sample_count = 3
        loop._cumulative_metrics = {"quality_score": [0.9, 0.8, 0.9]}
        result = loop.should_evolve({"quality_score": 0.1}, threshold=0.6)
        assert result is False

    def test_data_source_consistency_after_accumulate(self):
        """evaluate() 累积后，should_evolve 传入同一 evaluation 应与累积一致。"""
        loop = FeedbackLoop(min_sample_size=3)
        # 累积 3 个低分样本
        for score in [0.2, 0.3, 0.2]:
            loop._accumulate_sample({"quality_score": score, "relevance": 0.5})
        # 传入刚累积的 evaluation（quality_score=0.2）
        result = loop.should_evolve({"quality_score": 0.2}, threshold=0.6)
        assert result is True

    def test_insufficient_samples_returns_false(self):
        loop = FeedbackLoop(min_sample_size=10)
        loop._sample_count = 3
        loop._cumulative_metrics = {"quality_score": [0.1, 0.1, 0.1]}
        assert loop.should_evolve({"quality_score": 0.1}, threshold=0.6) is False

    def test_below_ratio_threshold_returns_false(self):
        """仅 33% 低于阈值，不满足 60%。"""
        loop = FeedbackLoop(min_sample_size=3)
        loop._sample_count = 3
        loop._cumulative_metrics = {"quality_score": [0.2, 0.9, 0.9]}
        assert loop.should_evolve({"quality_score": 0.2}, threshold=0.6) is False

    def test_exact_60_percent_triggers(self):
        """60% 低分边界应触发（min_sample_size=5，3 低 2 高）。"""
        loop = FeedbackLoop(min_sample_size=5)
        loop._sample_count = 5
        loop._cumulative_metrics = {"quality_score": [0.2, 0.9, 0.2, 0.9, 0.2]}
        assert loop.should_evolve({"quality_score": 0.2}, threshold=0.6) is True

    def test_threshold_boundary_strict_less(self):
        """quality_score == threshold 不算低于阈值（严格小于）。"""
        loop = FeedbackLoop(min_sample_size=1)
        loop._sample_count = 1
        loop._cumulative_metrics = {"quality_score": [0.5]}
        assert loop.should_evolve({"quality_score": 0.5}, threshold=0.5) is False

    def test_cumulative_just_below_threshold_triggers(self):
        loop = FeedbackLoop(min_sample_size=1)
        loop._sample_count = 1
        loop._cumulative_metrics = {"quality_score": [0.49]}
        assert loop.should_evolve({"quality_score": 0.49}, threshold=0.5) is True

    def test_empty_cumulative_returns_false(self):
        """累积为空时不触发（避免 IndexError）。"""
        loop = FeedbackLoop(min_sample_size=1)
        loop._sample_count = 1
        loop._cumulative_metrics = {}
        assert loop.should_evolve({"quality_score": 0.1}, threshold=0.6) is False

    def test_missing_quality_score_in_cumulative(self):
        """累积中无 quality_score 键时不报错。"""
        loop = FeedbackLoop(min_sample_size=1)
        loop._sample_count = 1
        loop._cumulative_metrics = {"relevance": [0.5]}
        assert loop.should_evolve({"quality_score": 0.1}, threshold=0.6) is False


# ======================================================================
# P1-5: BaseLLMReasoner 默认值从 RuntimeConfig 读取
# ======================================================================

class TestBaseLLMReasonerConfigDefaults:
    """P1-5: temperature/max_tokens 默认值应从 RuntimeConfig 读取。"""

    def test_resolve_temperature_reads_config(self):
        cfg = RuntimeConfig(config_data={"llm": {"temperature": 0.3}})
        with override_config(cfg):
            r = _ConcreteLLMReasoner(api_key="k", base_url="http://x", default_model="m")
            assert r._resolve_temperature({}) == 0.3

    def test_resolve_max_tokens_reads_config(self):
        cfg = RuntimeConfig(config_data={"llm": {"max_tokens": 1024}})
        with override_config(cfg):
            r = _ConcreteLLMReasoner(api_key="k", base_url="http://x", default_model="m")
            assert r._resolve_max_tokens({}) == 1024

    def test_resolve_temperature_kwargs_overrides_config(self):
        cfg = RuntimeConfig(config_data={"llm": {"temperature": 0.3}})
        with override_config(cfg):
            r = _ConcreteLLMReasoner(api_key="k", base_url="http://x", default_model="m")
            assert r._resolve_temperature({"temperature": 0.9}) == 0.9

    def test_resolve_max_tokens_kwargs_overrides_config(self):
        cfg = RuntimeConfig(config_data={"llm": {"max_tokens": 1024}})
        with override_config(cfg):
            r = _ConcreteLLMReasoner(api_key="k", base_url="http://x", default_model="m")
            assert r._resolve_max_tokens({"max_tokens": 64}) == 64

    def test_resolve_temperature_fallback_default(self):
        """无配置覆盖时回退到 0.7。"""
        reset_config()
        r = _ConcreteLLMReasoner(api_key="k", base_url="http://x", default_model="m")
        assert r._resolve_temperature({}) == 0.7

    def test_resolve_max_tokens_fallback_default(self):
        """无配置覆盖时回退到 512。"""
        reset_config()
        r = _ConcreteLLMReasoner(api_key="k", base_url="http://x", default_model="m")
        assert r._resolve_max_tokens({}) == 512

    def test_reason_payload_uses_config_defaults(self):
        """reason() 构建的 payload 应使用 RuntimeConfig 中的 temperature/max_tokens。"""
        cfg = RuntimeConfig(config_data={"llm": {"temperature": 0.4, "max_tokens": 200}})
        with override_config(cfg):
            r = _ConcreteLLMReasoner(api_key="k", base_url="http://x", default_model="m")
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json.return_value = {
                "choices": [{"message": {"content": "hi"}}],
                "usage": {},
            }
            r._client = MagicMock()
            r._client.post.return_value = mock_resp

            r.reason("prompt", {})
            payload = r._client.post.call_args.kwargs["json"]
            assert payload["temperature"] == 0.4
            assert payload["max_tokens"] == 200

    def test_reason_payload_kwargs_override_config(self):
        """reason() kwargs 应覆盖 RuntimeConfig 默认值。"""
        cfg = RuntimeConfig(config_data={"llm": {"temperature": 0.4, "max_tokens": 200}})
        with override_config(cfg):
            r = _ConcreteLLMReasoner(api_key="k", base_url="http://x", default_model="m")
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json.return_value = {
                "choices": [{"message": {"content": "hi"}}],
                "usage": {},
            }
            r._client = MagicMock()
            r._client.post.return_value = mock_resp

            r.reason("prompt", {}, temperature=0.8, max_tokens=999)
            payload = r._client.post.call_args.kwargs["json"]
            assert payload["temperature"] == 0.8
            assert payload["max_tokens"] == 999

    def test_stream_payload_uses_config_defaults(self):
        """stream() 构建的 payload 应使用 RuntimeConfig 中的值。"""
        cfg = RuntimeConfig(config_data={"llm": {"temperature": 0.2, "max_tokens": 128}})
        with override_config(cfg):
            r = _ConcreteLLMReasoner(api_key="k", base_url="http://x", default_model="m")
            # mock stream 上下文管理器
            mock_stream_ctx = MagicMock()
            mock_stream_ctx.__enter__ = MagicMock(return_value=mock_stream_ctx)
            mock_stream_ctx.__exit__ = MagicMock(return_value=False)
            mock_stream_ctx.raise_for_status = MagicMock()
            mock_stream_ctx.iter_lines = MagicMock(return_value=[])
            r._client = MagicMock()
            r._client.stream.return_value = mock_stream_ctx

            list(r.stream("prompt", {}))
            payload = r._client.stream.call_args.kwargs["json"]
            assert payload["temperature"] == 0.2
            assert payload["max_tokens"] == 128


# ======================================================================
# P2-1: report_interval=0 除零修复测试
# ======================================================================

class TestReportIntervalZeroGuard:
    """P2-1: report_interval=0 不应导致 ZeroDivisionError。"""

    def test_zero_interval_no_division_error(self):
        """report_interval=0 时多次 on_agent_event 不抛 ZeroDivisionError。"""
        collector = EvolutionSignalCollector(report_interval=0)
        event = _make_mock_event()
        for _ in range(10):
            collector.on_agent_event(event)  # 修复前此处在第 1 次即抛除零

    def test_zero_interval_clamped_to_one(self):
        """report_interval=0 钳制为 1，每个事件都生成信号。"""
        collector = EvolutionSignalCollector(report_interval=0)
        assert collector._report_interval == 1
        collector.on_agent_event(_make_mock_event())
        assert len(collector.get_signals()) == 1
        collector.on_agent_event(_make_mock_event())
        assert len(collector.get_signals()) == 2

    def test_negative_interval_clamped(self):
        """负数 report_interval 也应被钳制为正数。"""
        collector = EvolutionSignalCollector(report_interval=-5)
        assert collector._report_interval == 1
        # 不抛异常
        collector.on_agent_event(_make_mock_event())
        assert len(collector.get_signals()) == 1

    def test_one_interval_generates_signal_every_event(self):
        collector = EvolutionSignalCollector(report_interval=1)
        for i in range(3):
            collector.on_agent_event(_make_mock_event())
        assert len(collector.get_signals()) == 3

    def test_normal_interval_still_works(self):
        """正常 report_interval 行为不受影响。"""
        collector = EvolutionSignalCollector(report_interval=3)
        e = _make_mock_event()
        collector.on_agent_event(e)
        collector.on_agent_event(e)
        assert len(collector.get_signals()) == 0
        collector.on_agent_event(e)
        assert len(collector.get_signals()) == 1


# ======================================================================
# P2-3: deepseek 默认 model 笔误修复测试
# ======================================================================

class TestDeepSeekDefaultModel:
    """P2-3: deepseek 默认 model 应为有效的 deepseek-chat。"""

    def test_default_model_is_deepseek_chat(self):
        assert _DEFAULT_MODEL == "deepseek-chat"

    def test_default_model_not_invalid_v4_flash(self):
        assert _DEFAULT_MODEL != "deepseek-v4-flash"

    def test_reasoner_uses_correct_default_without_env(self, monkeypatch):
        """无环境变量时，DeepSeekLLMReasoner 使用 deepseek-chat。"""
        monkeypatch.delenv("MODU_DEEPSEEK_MODEL", raising=False)
        monkeypatch.delenv("LLM_DEFAULT_MODEL", raising=False)
        reasoner = DeepSeekLLMReasoner()
        assert reasoner.default_model == "deepseek-chat"

    def test_reasoner_env_overrides_default(self, monkeypatch):
        """环境变量仍可覆盖默认 model。"""
        monkeypatch.setenv("MODU_DEEPSEEK_MODEL", "deepseek-reasoner")
        monkeypatch.delenv("LLM_DEFAULT_MODEL", raising=False)
        reasoner = DeepSeekLLMReasoner()
        assert reasoner.default_model == "deepseek-reasoner"

    def test_reasoner_explicit_param_overrides_all(self, monkeypatch):
        """显式参数优先级最高。"""
        monkeypatch.setenv("MODU_DEEPSEEK_MODEL", "deepseek-reasoner")
        reasoner = DeepSeekLLMReasoner(default_model="deepseek-coder")
        assert reasoner.default_model == "deepseek-coder"


# ======================================================================
# P2-9: MemoryQuerySchema.context_window 枚举约束测试
# ======================================================================

class TestContextWindowEnumConstraint:
    """P2-9: context_window 应约束为合法枚举值或 last_<N>_turns 格式。"""

    @pytest.mark.parametrize("valid_value", sorted(VALID_CONTEXT_WINDOWS))
    def test_valid_enum_values_accepted(self, valid_value):
        s = MemoryQuerySchema(
            user_id="u1", context_window=valid_value, required_fields=["prompt"]
        )
        assert s.context_window == valid_value

    @pytest.mark.parametrize(
        "valid_value",
        ["last_2_turns", "last_7_turns", "last_20_turns", "last_100_turns"],
    )
    def test_last_N_turns_pattern_accepted(self, valid_value):
        """任意 last_<N>_turns（N>=1）均应接受，保持向前兼容。"""
        s = MemoryQuerySchema(
            user_id="u1", context_window=valid_value, required_fields=["prompt"]
        )
        assert s.context_window == valid_value

    @pytest.mark.parametrize(
        "invalid_value",
        [
            "invalid",
            "last_turns",
            "last_0_turns",
            "5_turns",
            "last_abc_turns",
            "last_-1_turns",
            "LAST_5_TURNS",
            "all_turns",
            "last_5",
            " turns",
        ],
    )
    def test_invalid_context_window_rejected(self, invalid_value):
        with pytest.raises(ValueError, match="context_window"):
            MemoryQuerySchema(
                user_id="u1", context_window=invalid_value, required_fields=["prompt"]
            )

    def test_empty_context_window_still_raises(self):
        with pytest.raises(ValueError, match="context_window"):
            MemoryQuerySchema(user_id="u1", context_window="", required_fields=["prompt"])

    def test_default_context_window_valid(self):
        """默认值 last_5_turns 应合法。"""
        s = MemoryQuerySchema(user_id="u1", required_fields=["prompt"])
        assert s.context_window == "last_5_turns"

    def test_to_dict_from_dict_roundtrip_valid(self):
        s = MemoryQuerySchema(
            user_id="u1", context_window="last_10_turns",
            required_fields=["prompt"], enable_compression=True,
        )
        restored = MemoryQuerySchema.from_dict(s.to_dict())
        assert restored.context_window == "last_10_turns"

    def test_is_valid_context_window_helper(self):
        assert _is_valid_context_window("last_5_turns") is True
        assert _is_valid_context_window("all") is True
        assert _is_valid_context_window("last_50_turns") is True
        assert _is_valid_context_window("invalid") is False
        assert _is_valid_context_window("last_0_turns") is False
        assert _is_valid_context_window("") is False


# ======================================================================
# P2-8: get_active_reasoning_engine 依赖 dict 顺序修复测试
# ======================================================================

class TestActiveReasoningEngine:
    """P2-8: get_active_reasoning_engine 应显式追踪活跃引擎，而非依赖 dict 顺序。"""

    def test_first_registered_is_active_by_default(self):
        """单引擎场景兼容性：首个注册引擎自动成为活跃引擎。"""
        reg = ComponentRegistry()
        e1 = _MockReasoningEngine()
        e2 = _MockReasoningEngine()
        reg.register_reasoning_engine("first", e1)
        reg.register_reasoning_engine("second", e2)
        assert reg.get_active_reasoning_engine() is e1

    def test_empty_registry_returns_none(self):
        reg = ComponentRegistry()
        assert reg.get_active_reasoning_engine() is None

    def test_set_active_switches_engine(self):
        """set_active_reasoning_engine 应切换活跃引擎。"""
        reg = ComponentRegistry()
        e1 = _MockReasoningEngine()
        e2 = _MockReasoningEngine()
        reg.register_reasoning_engine("a", e1)
        reg.register_reasoning_engine("b", e2)
        reg.set_active_reasoning_engine("b")
        assert reg.get_active_reasoning_engine() is e2

    def test_set_active_back_to_first(self):
        reg = ComponentRegistry()
        e1 = _MockReasoningEngine()
        e2 = _MockReasoningEngine()
        reg.register_reasoning_engine("a", e1)
        reg.register_reasoning_engine("b", e2)
        reg.set_active_reasoning_engine("b")
        reg.set_active_reasoning_engine("a")
        assert reg.get_active_reasoning_engine() is e1

    def test_set_active_nonexistent_raises_keyerror(self):
        reg = ComponentRegistry()
        reg.register_reasoning_engine("a", _MockReasoningEngine())
        with pytest.raises(KeyError, match="not registered"):
            reg.set_active_reasoning_engine("nonexistent")

    def test_set_active_empty_registry_raises_keyerror(self):
        reg = ComponentRegistry()
        with pytest.raises(KeyError):
            reg.set_active_reasoning_engine("anything")

    def test_active_survives_swap(self):
        """swap_component 替换活跃引擎后，get_active 仍返回该名称的新实例。"""
        reg = ComponentRegistry()
        e1 = _MockReasoningEngine()
        reg.register_reasoning_engine("a", e1)
        e2 = _MockReasoningEngine()
        reg.swap_component("reasoning_engine", "a", e2)
        assert reg.get_active_reasoning_engine() is e2

    def test_explicit_active_overrides_insertion_order(self):
        """显式设置活跃引擎优先于插入顺序。"""
        reg = ComponentRegistry()
        e1 = _MockReasoningEngine()
        e2 = _MockReasoningEngine()
        e3 = _MockReasoningEngine()
        reg.register_reasoning_engine("first", e1)
        reg.register_reasoning_engine("second", e2)
        reg.register_reasoning_engine("third", e3)
        reg.set_active_reasoning_engine("third")
        # 即使 first 是首个注册的，活跃应为 third
        assert reg.get_active_reasoning_engine() is e3

    def test_single_engine_active(self):
        reg = ComponentRegistry()
        e = _MockReasoningEngine()
        reg.register_reasoning_engine("only", e)
        assert reg.get_active_reasoning_engine() is e

    def test_active_name_tracked(self):
        """内部 _active_reasoning_engine_name 应正确追踪。"""
        reg = ComponentRegistry()
        assert reg._active_reasoning_engine_name is None
        reg.register_reasoning_engine("a", _MockReasoningEngine())
        assert reg._active_reasoning_engine_name == "a"
        reg.register_reasoning_engine("b", _MockReasoningEngine())
        assert reg._active_reasoning_engine_name == "a"  # 不变
        reg.set_active_reasoning_engine("b")
        assert reg._active_reasoning_engine_name == "b"
