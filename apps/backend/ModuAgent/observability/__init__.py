"""P3-12.3.5 可观测性体系模块。

提供 OpenTelemetry tracing、Prometheus metrics、结构化日志能力，
通过 ``observability.*`` 配置开关控制（默认全部关闭，避免影响现有流程）。

子模块：
    - tracing: OTel TracerProvider + OtelSpanManager（替代 runner._span）
    - metrics: Prometheus Registry + 指标定义
    - logging_config: JSON 结构化日志 Formatter
    - trace_context: trace_id 注入/提取 OTel context
    - exporters: OTLP / Prometheus endpoint 配置
"""
from __future__ import annotations

from observability.tracing import (
    OtelSpanManager,
    get_span_manager,
    is_tracing_enabled,
    reset_span_manager,
)
from observability.metrics import (
    MetricsRegistry,
    get_metrics_registry,
    is_metrics_enabled,
)
from observability.logging_config import (
    JsonFormatter,
    configure_structured_logging,
)
from observability.trace_context import (
    inject_trace_context,
    extract_trace_context,
)
from observability.exporters import (
    configure_otlp_exporter,
    start_prometheus_server,
)

__all__ = [
    # tracing
    "OtelSpanManager",
    "get_span_manager",
    "is_tracing_enabled",
    "reset_span_manager",
    # metrics
    "MetricsRegistry",
    "get_metrics_registry",
    "is_metrics_enabled",
    # logging
    "JsonFormatter",
    "configure_structured_logging",
    # trace_context
    "inject_trace_context",
    "extract_trace_context",
    # exporters
    "configure_otlp_exporter",
    "start_prometheus_server",
]
