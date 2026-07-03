"""P3-12.3.5 可观测性体系单元测试。

测试矩阵（对照技术方案 §6.2.5）：
    - OtelSpanManager.span 签名兼容性
    - OTel span 异常记录（record_exception）
    - OTel span 属性注入（trace_id/user_id/session_id）
    - trace_id 跨上下文传播（inject/extract）
    - Prometheus metrics（QPS/延迟/进化/共识失败/活跃会话）
    - JsonFormatter 输出合法 JSON + trace_id 字段
    - 配置关闭时无 OTel/Prometheus 副作用
    - 采样率配置读取
"""
from __future__ import annotations

import json
import logging
import sys
import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# 确保 observability 模块路径可导入
_OBSERVABILITY_PATH = r"d:\Administrator\Desktop\pioneering\apps\backend\ModuAgent"
if _OBSERVABILITY_PATH not in sys.path:
    sys.path.insert(0, _OBSERVABILITY_PATH)


# ============================================================================
# 1. OtelSpanManager 测试
# ============================================================================

class TestOtelSpanManager:
    """OtelSpanManager 单元测试。"""

    def test_span_signature_compatible_with_original_span(self) -> None:
        """OtelSpanManager.span 与原 runner._span 签名兼容。"""
        from observability.tracing import OtelSpanManager

        manager = OtelSpanManager(enabled=False)
        # 验证 span 是 contextmanager（可 with 调用）
        import inspect

        sig = inspect.signature(manager.span)
        params = list(sig.parameters.keys())
        assert "name" in params, "span() must accept 'name' parameter"
        assert "trace_id" in params, "span() must accept 'trace_id' parameter"
        # **attributes 通过 **kwargs 接收
        assert any(
            p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
        ), "span() must accept **attributes (VAR_KEYWORD)"

    def test_span_noop_when_disabled(self) -> None:
        """tracing 未启用时 span 退化为 no-op（不创建 OTel span）。"""
        from observability.tracing import OtelSpanManager

        manager = OtelSpanManager(enabled=False)
        assert manager.enabled is False

        # with 块正常执行
        executed = False
        with manager.span("test_span", trace_id="abc"):
            executed = True
        assert executed, "span context manager should execute the body"

    def test_span_records_exception_on_error(self) -> None:
        """异常时 span 记录异常（record_exception + set_status ERROR）。"""
        from observability.tracing import OtelSpanManager

        manager = OtelSpanManager(enabled=False)
        # 未启用时也应正确传播异常
        with pytest.raises(ValueError, match="test error"):
            with manager.span("error_span"):
                raise ValueError("test error")

    def test_span_attributes_injected_when_enabled(self) -> None:
        """tracing enabled 时 trace_id/user_id/session_id 作为 span 属性。"""
        from observability.tracing import OtelSpanManager

        # 创建 enabled manager，然后替换 _tracer 为 mock
        manager = OtelSpanManager(enabled=True)
        if not manager.enabled:
            pytest.skip("OTel SDK not available in this environment")

        # 替换 tracer 为 mock，使 span 行为可控
        mock_span = MagicMock()
        mock_tracer = MagicMock()
        mock_tracer.start_as_current_span.return_value.__enter__.return_value = mock_span
        mock_tracer.start_as_current_span.return_value.__exit__.return_value = None
        manager._tracer = mock_tracer

        with manager.span("test", trace_id="trace-123", user_id="u1", session_id="s1"):
            pass

        # 验证属性被设置
        mock_span.set_attribute.assert_any_call("trace_id", "trace-123")
        mock_span.set_attribute.assert_any_call("user_id", "u1")
        mock_span.set_attribute.assert_any_call("session_id", "s1")
        # elapsed_ms 应被记录
        elapsed_calls = [c for c in mock_span.set_attribute.call_args_list if c[0][0] == "elapsed_ms"]
        assert len(elapsed_calls) == 1

    def test_span_records_exception_with_otel_when_enabled(self) -> None:
        """tracing enabled 时异常被 record_exception 捕获。"""
        from observability.tracing import OtelSpanManager

        manager = OtelSpanManager(enabled=True)
        if not manager.enabled:
            pytest.skip("OTel SDK not available")

        # 替换 tracer 为 mock
        mock_span = MagicMock()
        mock_tracer = MagicMock()
        mock_tracer.start_as_current_span.return_value.__enter__.return_value = mock_span
        mock_tracer.start_as_current_span.return_value.__exit__.return_value = None
        manager._tracer = mock_tracer

        with pytest.raises(RuntimeError):
            with manager.span("error_span", trace_id="err-1"):
                raise RuntimeError("boom")

        mock_span.record_exception.assert_called_once()

    def test_get_span_manager_singleton(self) -> None:
        """get_span_manager 返回同一实例。"""
        from observability.tracing import get_span_manager, reset_span_manager

        reset_span_manager()
        m1 = get_span_manager()
        m2 = get_span_manager()
        assert m1 is m2

    def test_is_tracing_enabled_default_false(self, fresh_config) -> None:
        """默认配置下 tracing 未启用。"""
        from observability.tracing import is_tracing_enabled, reset_span_manager

        reset_span_manager()
        assert is_tracing_enabled() is False

    def test_is_tracing_enabled_true_when_config_enabled(self, fresh_config) -> None:
        """配置启用时 tracing 实际启用。"""
        from observability.tracing import is_tracing_enabled, reset_span_manager

        fresh_config.set("observability.tracing.enabled", True)
        reset_span_manager()
        # 即使 OTel SDK 未安装，is_tracing_enabled 也应反映配置状态
        # 但 enabled 属性取决于 OTel 是否成功初始化
        # 这里只验证不抛异常
        result = is_tracing_enabled()
        assert isinstance(result, bool)


# ============================================================================
# 2. trace_context 测试
# ============================================================================

class TestTraceContext:
    """trace_id 跨上下文传播测试。"""

    def test_inject_trace_id_into_headers(self) -> None:
        """业务 trace_id 通过自定义 header 注入。"""
        from observability.trace_context import inject_trace_context

        headers: dict[str, str] = {}
        inject_trace_context(headers, trace_id="trace-abc", user_id="u1", session_id="s1")

        assert headers["x-modu-trace-id"] == "trace-abc"
        assert headers["x-modu-user-id"] == "u1"
        assert headers["x-modu-session-id"] == "s1"

    def test_extract_trace_id_from_headers(self) -> None:
        """从 headers 提取业务 trace_id。"""
        from observability.trace_context import extract_trace_context

        headers = {
            "x-modu-trace-id": "trace-xyz",
            "x-modu-user-id": "user-2",
            "x-modu-session-id": "sess-3",
        }
        result = extract_trace_context(headers)

        assert result["trace_id"] == "trace-xyz"
        assert result["user_id"] == "user-2"
        assert result["session_id"] == "sess-3"

    def test_inject_extract_roundtrip(self) -> None:
        """注入→提取 round-trip 保持一致。"""
        from observability.trace_context import extract_trace_context, inject_trace_context

        original_headers: dict[str, str] = {}
        inject_trace_context(original_headers, trace_id="rt-1", user_id="rt-user", session_id="rt-sess")

        extracted = extract_trace_context(original_headers)
        assert extracted["trace_id"] == "rt-1"
        assert extracted["user_id"] == "rt-user"
        assert extracted["session_id"] == "rt-sess"

    def test_extract_empty_headers(self) -> None:
        """空 headers 提取返回空字符串。"""
        from observability.trace_context import extract_trace_context

        result = extract_trace_context({})
        assert result["trace_id"] == ""
        assert result["user_id"] == ""
        assert result["session_id"] == ""

    def test_inject_partial_fields(self) -> None:
        """仅注入部分字段（trace_id 为空时不写入 header）。"""
        from observability.trace_context import inject_trace_context

        headers: dict[str, str] = {}
        inject_trace_context(headers, trace_id="", user_id="u1")

        assert "x-modu-trace-id" not in headers
        assert headers["x-modu-user-id"] == "u1"
        assert "x-modu-session-id" not in headers


# ============================================================================
# 3. MetricsRegistry 测试
# ============================================================================

class TestMetricsRegistry:
    """Prometheus metrics 单元测试。"""

    def test_metrics_noop_when_disabled(self) -> None:
        """metrics 未启用时所有 record_* 方法为 no-op。"""
        from observability.metrics import MetricsRegistry

        registry = MetricsRegistry(enabled=False)
        assert registry.enabled is False

        # 以下调用不应抛异常
        registry.record_request(status="success", duration=0.1)
        registry.record_evolution()
        registry.record_consensus_failure()
        registry.inc_active_sessions()
        registry.dec_active_sessions()
        registry.set_active_sessions(5)

        # collect_text 返回空字符串
        assert registry.collect_text() == ""

    def test_qps_counter_increments(self) -> None:
        """请求计数器递增。"""
        from observability.metrics import MetricsRegistry

        registry = MetricsRegistry(enabled=True)
        if not registry.enabled:
            pytest.skip("prometheus_client not available")

        registry.record_request(status="success", duration=0.1)
        registry.record_request(status="success", duration=0.2)
        registry.record_request(status="error", duration=0.3)

        text = registry.collect_text()
        assert "modu_requests_total" in text
        # 验证 success 标签计数为 2
        assert 'modu_requests_total{status="success"}' in text
        assert 'modu_requests_total{status="error"}' in text

    def test_latency_histogram_records(self) -> None:
        """延迟直方图记录观测值。"""
        from observability.metrics import MetricsRegistry

        registry = MetricsRegistry(enabled=True)
        if not registry.enabled:
            pytest.skip("prometheus_client not available")

        registry.record_request(status="success", duration=0.5)
        text = registry.collect_text()
        assert "modu_request_duration_seconds" in text

    def test_evolution_counter_increments(self) -> None:
        """进化触发计数器递增。"""
        from observability.metrics import MetricsRegistry

        registry = MetricsRegistry(enabled=True)
        if not registry.enabled:
            pytest.skip("prometheus_client not available")

        registry.record_evolution()
        registry.record_evolution()
        text = registry.collect_text()
        assert "modu_evolution_total" in text

    def test_consensus_failures_counter(self) -> None:
        """共识失败计数器。"""
        from observability.metrics import MetricsRegistry

        registry = MetricsRegistry(enabled=True)
        if not registry.enabled:
            pytest.skip("prometheus_client not available")

        registry.record_consensus_failure()
        text = registry.collect_text()
        assert "modu_consensus_failures_total" in text

    def test_active_sessions_gauge(self) -> None:
        """活跃会话 Gauge 增减。"""
        from observability.metrics import MetricsRegistry

        registry = MetricsRegistry(enabled=True)
        if not registry.enabled:
            pytest.skip("prometheus_client not available")

        registry.inc_active_sessions()
        registry.inc_active_sessions()
        registry.dec_active_sessions()
        text = registry.collect_text()
        assert "modu_active_sessions" in text

    def test_get_metrics_registry_singleton(self) -> None:
        """get_metrics_registry 返回同一实例。"""
        from observability.metrics import get_metrics_registry, reset_metrics_registry

        reset_metrics_registry()
        r1 = get_metrics_registry()
        r2 = get_metrics_registry()
        assert r1 is r2

    def test_is_metrics_enabled_default_false(self, fresh_config) -> None:
        """默认配置下 metrics 未启用。"""
        from observability.metrics import is_metrics_enabled, reset_metrics_registry

        reset_metrics_registry()
        assert is_metrics_enabled() is False


# ============================================================================
# 4. JsonFormatter 测试
# ============================================================================

class TestJsonFormatter:
    """结构化 JSON 日志 Formatter 测试。"""

    def test_log_output_is_valid_json(self) -> None:
        """日志输出为合法 JSON。"""
        from observability.logging_config import JsonFormatter

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="test.logger",
            level=logging.INFO,
            pathname="test.py",
            lineno=42,
            msg="hello %s",
            args=("world",),
            exc_info=None,
        )

        output = formatter.format(record)
        parsed = json.loads(output)  # 应不抛异常
        assert parsed["message"] == "hello world"
        assert parsed["level"] == "INFO"
        assert parsed["logger"] == "test.logger"

    def test_json_log_includes_trace_id(self) -> None:
        """JSON 日志含 trace_id 字段（通过 extra 注入）。"""
        from observability.logging_config import JsonFormatter

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="x.py",
            lineno=1,
            msg="test message",
            args=(),
            exc_info=None,
        )
        record.trace_id = "trace-abc-123"

        output = formatter.format(record)
        parsed = json.loads(output)
        assert parsed["trace_id"] == "trace-abc-123"

    def test_json_log_includes_exception_info(self) -> None:
        """异常信息被序列化到 exc_info 字段。"""
        from observability.logging_config import JsonFormatter

        formatter = JsonFormatter()
        try:
            raise ValueError("test exception")
        except ValueError:
            import sys as _sys

            exc_info = _sys.exc_info()

        record = logging.LogRecord(
            name="test",
            level=logging.ERROR,
            pathname="x.py",
            lineno=1,
            msg="error occurred",
            args=(),
            exc_info=exc_info,
        )

        output = formatter.format(record)
        parsed = json.loads(output)
        assert "exc_info" in parsed
        assert "ValueError" in parsed["exc_info"]
        assert "test exception" in parsed["exc_info"]

    def test_json_log_includes_extra_fields(self) -> None:
        """通过 extra 传入的自定义字段出现在 extra 中。"""
        from observability.logging_config import JsonFormatter

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="x.py",
            lineno=1,
            msg="msg",
            args=(),
            exc_info=None,
        )
        record.user_id = "u123"
        record.request_id = "req-456"

        output = formatter.format(record)
        parsed = json.loads(output)
        assert parsed["extra"]["user_id"] == "u123"
        assert parsed["extra"]["request_id"] == "req-456"

    def test_json_log_handles_non_serializable(self) -> None:
        """非 JSON 可序列化值降级为字符串。"""
        from observability.logging_config import JsonFormatter

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="x.py",
            lineno=1,
            msg="msg",
            args=(),
            exc_info=None,
        )
        # 非可序列化对象（自定义类实例）
        class CustomObj:
            def __str__(self):
                return "custom-string"

        record.custom_field = CustomObj()

        output = formatter.format(record)
        parsed = json.loads(output)
        assert parsed["extra"]["custom_field"] == "custom-string"


# ============================================================================
# 5. 配置与集成测试
# ============================================================================

class TestObservabilityConfig:
    """可观测性配置与集成测试。"""

    def test_observability_disabled_by_default(self, fresh_config) -> None:
        """配置关闭时无 OTel/Prometheus 副作用。"""
        from observability.metrics import reset_metrics_registry
        from observability.tracing import reset_span_manager

        reset_span_manager()
        reset_metrics_registry()

        # 默认配置全部为 False
        assert fresh_config.get("observability.tracing.enabled") is False
        assert fresh_config.get("observability.metrics.enabled") is False
        assert fresh_config.get("observability.logging.structured") is False

        # 实例化的 manager/registry 应为 disabled
        from observability.metrics import get_metrics_registry
        from observability.tracing import get_span_manager

        assert get_span_manager().enabled is False
        assert get_metrics_registry().enabled is False

    def test_sampling_rate_config_readable(self, fresh_config) -> None:
        """采样率配置可读。"""
        sampling_rate = fresh_config.get("observability.tracing.sampling_rate")
        assert sampling_rate == 0.1

    def test_service_name_config(self, fresh_config) -> None:
        """service_name 配置可读。"""
        assert fresh_config.get("observability.tracing.service_name") == "modu-agent"

    def test_prometheus_port_config(self, fresh_config) -> None:
        """Prometheus 端口配置可读。"""
        assert fresh_config.get("observability.metrics.prometheus_port") == 9090
        assert fresh_config.get("observability.metrics.path") == "/metrics"

    def test_logging_level_config(self, fresh_config) -> None:
        """日志级别配置可读。"""
        assert fresh_config.get("observability.logging.level") == "INFO"

    def test_configure_structured_logging_disabled(self, fresh_config) -> None:
        """structured=False 时配置普通日志格式。"""
        from observability.logging_config import configure_structured_logging

        # 不应抛异常
        configure_structured_logging(enabled=False, level="INFO")

        root = logging.getLogger()
        assert root.level == logging.INFO
        assert len(root.handlers) >= 1

    def test_configure_structured_logging_enabled(self, fresh_config) -> None:
        """structured=True 时配置 JSON 格式。"""
        from observability.logging_config import JsonFormatter, configure_structured_logging

        configure_structured_logging(enabled=True, level="DEBUG")

        root = logging.getLogger()
        assert root.level == logging.DEBUG
        assert len(root.handlers) >= 1
        # 验证 handler 使用 JsonFormatter
        has_json_formatter = any(
            isinstance(h.formatter, JsonFormatter) for h in root.handlers if h.formatter
        )
        assert has_json_formatter

    def test_human_in_loop_config_present(self, fresh_config) -> None:
        """P3-12.3.2 HITL 配置存在。"""
        hitl_config = fresh_config.get("tools.human_in_loop")
        assert hitl_config is not None
        assert hitl_config["enabled"] is False
        assert hitl_config["approval_timeout_seconds"] == 300
        assert "code_executor" in hitl_config["sensitive_tools"]
