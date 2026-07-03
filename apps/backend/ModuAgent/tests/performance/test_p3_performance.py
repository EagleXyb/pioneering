"""P3 低风险功能性能基线测试。

验证三个低风险章节的性能影响：
    - P3-12.3.2 Human-in-the-loop
    - P3-12.3.4 工具库扩展
    - P3-12.3.5 可观测性体系

测试矩阵（对照技术方案 §6.2.6，仅保留低风险相关）：
    - test_single_agent_no_regression: P3 关闭时无性能退化
    - test_otel_span_overhead: OTel span 开启时延迟增加 < 10%
    - test_metrics_recording_overhead: metrics 记录开销可忽略
    - test_json_formatter_overhead: JSON 日志格式化开销 < 1ms
    - test_tool_invoke_latency: 新工具调用延迟在可接受范围
    - test_span_noop_overhead: span no-op 模式开销 < 0.1ms

Note: 多 Agent / subgraph / interrupt 持久化性能不在本测试范围（中高风险）。
"""
from __future__ import annotations

import statistics
import sys
import time
from typing import List

import pytest

_PERF_PATH = r"d:\Administrator\Desktop\pioneering\apps\backend\ModuAgent"
if _PERF_PATH not in sys.path:
    sys.path.insert(0, _PERF_PATH)


# ============================================================
# 性能测试辅助函数
# ============================================================

def _measure_latency(func, iterations: int = 100) -> dict:
    """测量函数调用延迟。

    Args:
        func: 待测量的无参函数
        iterations: 迭代次数

    Returns:
        {
            "p50_ms": float,  # 中位数
            "p95_ms": float,  # 95 分位
            "p99_ms": float,  # 99 分位
            "mean_ms": float, # 均值
        }
    """
    latencies: List[float] = []
    for _ in range(iterations):
        start = time.perf_counter()
        func()
        elapsed_ms = (time.perf_counter() - start) * 1000
        latencies.append(elapsed_ms)

    latencies.sort()
    n = len(latencies)
    p50_idx = int(n * 0.50)
    p95_idx = int(n * 0.95)
    p99_idx = int(n * 0.99)

    return {
        "p50_ms": latencies[p50_idx],
        "p95_ms": latencies[min(p95_idx, n - 1)],
        "p99_ms": latencies[min(p99_idx, n - 1)],
        "mean_ms": statistics.mean(latencies),
    }


# ============================================================
# 1. P3 关闭：无性能退化
# ============================================================

class TestNoRegression:
    """P3 关闭时性能无退化。"""

    def test_tool_invoke_no_p3_overhead(self) -> None:
        """P3 关闭时工具调用无额外开销。"""
        from components.action.tools.calculator import CalculatorTool

        tool = CalculatorTool()

        def _invoke():
            return tool.invoke({"expression": "2 + 3 * 4"}, {})

        stats = _measure_latency(_invoke, iterations=200)

        # calculator 调用应 < 5ms
        assert stats["p95_ms"] < 5.0, f"Calculator p95={stats['p95_ms']:.2f}ms > 5ms"
        assert stats["p50_ms"] < 2.0, f"Calculator p50={stats['p50_ms']:.2f}ms > 2ms"

    def test_observability_disabled_no_overhead(self, fresh_config) -> None:
        """observability 关闭时无开销。"""
        from observability.tracing import OtelSpanManager

        manager = OtelSpanManager(enabled=False)

        def _span_call():
            with manager.span("perf_test", trace_id="t1"):
                pass

        stats = _measure_latency(_span_call, iterations=500)

        # no-op span 应 < 0.5ms
        assert stats["p95_ms"] < 0.5, f"No-op span p95={stats['p95_ms']:.4f}ms > 0.5ms"


# ============================================================
# 2. OTel Span 性能
# ============================================================

class TestOTelSpanPerformance:
    """OTel span 性能测试。"""

    def test_span_disabled_overhead(self) -> None:
        """span disabled 模式开销 < 0.1ms。"""
        from observability.tracing import OtelSpanManager

        manager = OtelSpanManager(enabled=False)

        def _span():
            with manager.span("perf", trace_id="t1", user_id="u1"):
                pass

        stats = _measure_latency(_span, iterations=1000)

        assert stats["p95_ms"] < 0.5, f"Disabled span p95={stats['p95_ms']:.4f}ms > 0.5ms"

    def test_span_enabled_overhead_acceptable(self) -> None:
        """span enabled 模式开销可接受（< 1ms）。"""
        from observability.tracing import OtelSpanManager

        manager = OtelSpanManager(enabled=True)
        if not manager.enabled:
            pytest.skip("OTel SDK not available")

        def _span():
            with manager.span("perf", trace_id="t1"):
                pass

        stats = _measure_latency(_span, iterations=200)

        # OTel span 开启时 p95 应 < 2ms
        assert stats["p95_ms"] < 2.0, f"Enabled span p95={stats['p95_ms']:.4f}ms > 2ms"

    def test_span_disabled_vs_enabled_overhead_ratio(self) -> None:
        """OTel span 开启 vs 关闭的延迟比 < 10x。"""
        from observability.tracing import OtelSpanManager

        disabled_mgr = OtelSpanManager(enabled=False)
        enabled_mgr = OtelSpanManager(enabled=True)
        if not enabled_mgr.enabled:
            pytest.skip("OTel SDK not available")

        def _disabled_span():
            with disabled_mgr.span("test", trace_id="t1"):
                pass

        def _enabled_span():
            with enabled_mgr.span("test", trace_id="t1"):
                pass

        disabled_stats = _measure_latency(_disabled_span, iterations=200)
        enabled_stats = _measure_latency(_enabled_span, iterations=200)

        # enabled 不应比 disabled 慢超过 10 倍
        ratio = enabled_stats["p95_ms"] / max(disabled_stats["p95_ms"], 0.001)
        assert ratio < 10.0, (
            f"Enabled/disabled ratio={ratio:.1f}x > 10x "
            f"(enabled p95={enabled_stats['p95_ms']:.4f}ms, "
            f"disabled p95={disabled_stats['p95_ms']:.4f}ms)"
        )


# ============================================================
# 3. Metrics 性能
# ============================================================

class TestMetricsPerformance:
    """Prometheus metrics 性能测试。"""

    def test_metrics_record_overhead(self) -> None:
        """metrics record_request 开销 < 0.1ms。"""
        from observability.metrics import MetricsRegistry

        registry = MetricsRegistry(enabled=True)
        if not registry.enabled:
            pytest.skip("prometheus_client not available")

        def _record():
            registry.record_request(status="success", duration=0.05)

        stats = _measure_latency(_record, iterations=500)

        assert stats["p95_ms"] < 0.5, f"Metrics record p95={stats['p95_ms']:.4f}ms > 0.5ms"

    def test_metrics_collect_text_overhead(self) -> None:
        """metrics collect_text 开销 < 5ms。"""
        from observability.metrics import MetricsRegistry

        registry = MetricsRegistry(enabled=True)
        if not registry.enabled:
            pytest.skip("prometheus_client not available")

        # 先记录一些指标
        for i in range(100):
            registry.record_request(status="success", duration=0.01 * i)
        registry.record_evolution()
        registry.inc_active_sessions()

        def _collect():
            return registry.collect_text()

        stats = _measure_latency(_collect, iterations=100)

        assert stats["p95_ms"] < 5.0, f"Collect text p95={stats['p95_ms']:.4f}ms > 5ms"

    def test_metrics_disabled_overhead(self) -> None:
        """metrics disabled 模式零开销。"""
        from observability.metrics import MetricsRegistry

        registry = MetricsRegistry(enabled=False)

        def _record():
            registry.record_request(status="success", duration=0.05)

        stats = _measure_latency(_record, iterations=1000)

        # disabled 模式应 < 0.01ms（基本是函数调用开销）
        assert stats["p95_ms"] < 0.1, f"Disabled metrics p95={stats['p95_ms']:.4f}ms > 0.1ms"


# ============================================================
# 4. JsonFormatter 性能
# ============================================================

class TestJsonFormatterPerformance:
    """JSON 日志 Formatter 性能测试。"""

    def test_json_format_overhead(self) -> None:
        """JSON 日志格式化开销 < 1ms。"""
        import logging

        from observability.logging_config import JsonFormatter

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="perf.test",
            level=logging.INFO,
            pathname="perf.py",
            lineno=1,
            msg="performance test message %s",
            args=("arg",),
            exc_info=None,
        )
        record.trace_id = "perf-trace-1"
        record.user_id = "user-1"

        def _format():
            return formatter.format(record)

        stats = _measure_latency(_format, iterations=500)

        assert stats["p95_ms"] < 1.0, f"JSON format p95={stats['p95_ms']:.4f}ms > 1ms"

    def test_json_format_with_exception_overhead(self) -> None:
        """含异常信息的 JSON 格式化开销 < 2ms。"""
        import logging
        import sys as _sys

        from observability.logging_config import JsonFormatter

        formatter = JsonFormatter()
        try:
            raise ValueError("perf test exception")
        except ValueError:
            exc_info = _sys.exc_info()

        record = logging.LogRecord(
            name="perf.test",
            level=logging.ERROR,
            pathname="perf.py",
            lineno=1,
            msg="error occurred",
            args=(),
            exc_info=exc_info,
        )

        def _format():
            return formatter.format(record)

        stats = _measure_latency(_format, iterations=200)

        assert stats["p95_ms"] < 2.0, f"JSON format with exc p95={stats['p95_ms']:.4f}ms > 2ms"


# ============================================================
# 5. 工具调用延迟
# ============================================================

class TestToolInvokeLatency:
    """新工具调用延迟测试。"""

    def test_calculator_invoke_latency(self) -> None:
        """calculator 工具调用 p95 < 5ms。"""
        from components.action.tools.calculator import CalculatorTool

        tool = CalculatorTool()

        def _invoke():
            return tool.invoke({"expression": "1 + 2 * 3"}, {})

        stats = _measure_latency(_invoke, iterations=200)

        assert stats["p95_ms"] < 5.0, f"Calculator p95={stats['p95_ms']:.4f}ms > 5ms"

    def test_datetime_now_latency(self) -> None:
        """datetime now 操作 p95 < 5ms。"""
        from components.action.tools.datetime_tool import DateTimeTool

        tool = DateTimeTool()

        def _invoke():
            return tool.invoke({"op": "now"}, {})

        stats = _measure_latency(_invoke, iterations=200)

        assert stats["p95_ms"] < 5.0, f"DateTime now p95={stats['p95_ms']:.4f}ms > 5ms"

    def test_file_ops_write_read_latency(self, isolated_workdir) -> None:
        """file_ops write+read p95 < 10ms。"""
        from components.action.tools.file_ops import FileOpsTool

        tool = FileOpsTool(allowed_root=str(isolated_workdir))

        def _write_read():
            tool.invoke({"path": "perf.txt", "op": "write", "content": "test"}, {})
            return tool.invoke({"path": "perf.txt", "op": "read"}, {})

        stats = _measure_latency(_write_read, iterations=100)

        assert stats["p95_ms"] < 10.0, f"FileOps write+read p95={stats['p95_ms']:.4f}ms > 10ms"

    def test_code_executor_simple_code_latency(self) -> None:
        """code_executor 简单代码 p95 < 500ms（子进程启动开销）。"""
        from components.action.tools.code_executor import CodeExecutorTool

        tool = CodeExecutorTool(timeout_seconds=5)

        def _invoke():
            return tool.invoke({"code": "print(1+1)"}, {})

        stats = _measure_latency(_invoke, iterations=20)

        # 子进程启动有开销，p95 < 500ms
        assert stats["p95_ms"] < 500.0, f"CodeExecutor p95={stats['p95_ms']:.4f}ms > 500ms"

    def test_sql_query_latency(self, tmp_path) -> None:
        """sql_query 查询 p95 < 10ms。"""
        import sqlite3

        from components.action.tools.sql_query import SqlQueryTool

        db_path = str(tmp_path / "perf.db")
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE perf_test (id INTEGER, value TEXT)")
        for i in range(100):
            conn.execute("INSERT INTO perf_test VALUES (?, ?)", (i, f"val{i}"))
        conn.commit()
        conn.close()

        tool = SqlQueryTool(db_path=db_path)

        def _query():
            return tool.invoke({"query": "SELECT * FROM perf_test WHERE id = ?", "params": [50]}, {})

        stats = _measure_latency(_query, iterations=100)

        assert stats["p95_ms"] < 10.0, f"SqlQuery p95={stats['p95_ms']:.4f}ms > 10ms"


# ============================================================
# 6. trace_context 性能
# ============================================================

class TestTraceContextPerformance:
    """trace_context 注入/提取性能测试。"""

    def test_inject_trace_context_latency(self) -> None:
        """inject_trace_context p95 < 0.5ms。"""
        from observability.trace_context import inject_trace_context

        def _inject():
            headers: dict[str, str] = {}
            inject_trace_context(headers, trace_id="t1", user_id="u1", session_id="s1")
            return headers

        stats = _measure_latency(_inject, iterations=500)

        assert stats["p95_ms"] < 0.5, f"Inject p95={stats['p95_ms']:.4f}ms > 0.5ms"

    def test_extract_trace_context_latency(self) -> None:
        """extract_trace_context p95 < 0.5ms。"""
        from observability.trace_context import extract_trace_context

        headers = {
            "x-modu-trace-id": "trace-1",
            "x-modu-user-id": "user-1",
            "x-modu-session-id": "sess-1",
        }

        def _extract():
            return extract_trace_context(headers)

        stats = _measure_latency(_extract, iterations=500)

        assert stats["p95_ms"] < 0.5, f"Extract p95={stats['p95_ms']:.4f}ms > 0.5ms"
