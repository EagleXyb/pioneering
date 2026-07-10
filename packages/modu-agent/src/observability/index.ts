// 对应 Python: observability/__init__.py
// observability 模块统一导出
// 提供 OpenTelemetry tracing、Prometheus metrics、结构化日志能力

// tracing
export {
  type SpanHandle,
  OtelSpanManager,
  get_span_manager,
  reset_span_manager,
  is_tracing_enabled,
} from './tracing.js'

// metrics
export {
  MetricsRegistry,
  get_metrics_registry,
  is_metrics_enabled,
  reset_metrics_registry,
} from './metrics.js'

// logging_config
export {
  type LogLevel,
  type LogEntry,
  LogLevel as LogLevelConst,
  JsonFormatter,
  configure_structured_logging,
  get_log_level_int,
  is_structured_logging_enabled,
  get_current_log_level,
} from './logging-config.js'

// trace_context
export {
  type TraceContext,
  inject_trace_context,
  extract_trace_context,
  attach_otel_context,
  detach_otel_context,
} from './trace-context.js'

// exporters
export {
  configure_otlp_exporter,
  start_prometheus_server,
  stop_prometheus_server,
  reset_exporters,
} from './exporters.js'
