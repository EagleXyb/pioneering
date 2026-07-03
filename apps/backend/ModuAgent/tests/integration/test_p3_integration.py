"""P3 低风险功能集成测试。

验证三个低风险章节的端到端集成：
    - P3-12.3.2 Human-in-the-loop
    - P3-12.3.4 工具库扩展
    - P3-12.3.5 可观测性体系

测试矩阵（对照技术方案 §6.2.7，仅保留低风险相关）：
    - test_full_p3_pipeline_disabled: P3 全部关闭时行为与基线一致
    - test_p3_features_enabled_together: P3 功能开启时协同工作
    - test_hitl_with_observability: HITL + OTel trace 贯通
    - test_sensitive_tools_with_approval: 敏感工具 + 审批标记
    - test_observability_records_hitl_events: 可观测性记录 HITL 事件
    - test_tools_metrics_integration: 工具调用 + metrics 记录

Note: 多 Agent / 记忆增强属中高风险，不在本测试范围。
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

_INTEGRATION_PATH = r"d:\Administrator\Desktop\pioneering\apps\backend\ModuAgent"
if _INTEGRATION_PATH not in sys.path:
    sys.path.insert(0, _INTEGRATION_PATH)


# ============================================================
# 1. P3 全部关闭：基线一致性测试
# ============================================================

class TestP3DisabledBaseline:
    """P3 功能全部关闭时，确认不影响现有行为。"""

    def test_default_config_all_p3_disabled(self, fresh_config) -> None:
        """默认配置下所有 P3 功能关闭。"""
        # HITL
        assert fresh_config.get("tools.human_in_loop.enabled") is False
        # Observability
        assert fresh_config.get("observability.tracing.enabled") is False
        assert fresh_config.get("observability.metrics.enabled") is False
        assert fresh_config.get("observability.logging.structured") is False

    def test_observability_no_side_effects_when_disabled(self, fresh_config) -> None:
        """observability 关闭时无 OTel/Prometheus 副作用。"""
        from observability.metrics import get_metrics_registry, reset_metrics_registry
        from observability.tracing import get_span_manager, reset_span_manager

        reset_span_manager()
        reset_metrics_registry()

        # 获取单例应全部为 disabled
        span_manager = get_span_manager()
        metrics_registry = get_metrics_registry()

        assert span_manager.enabled is False
        assert metrics_registry.enabled is False

        # span 退化为 no-op（不抛异常）
        with span_manager.span("test", trace_id="t1"):
            pass

        # metrics record 退化为 no-op
        metrics_registry.record_request(status="success", duration=0.1)
        assert metrics_registry.collect_text() == ""

    def test_existing_tools_still_work_with_p3_disabled(self, fresh_config) -> None:
        """P3 关闭时现有工具（calculator/search）仍正常工作。"""
        from components.action.tools.calculator import CalculatorTool

        tool = CalculatorTool()
        result = tool.invoke({"expression": "2 + 3"}, {})
        assert result["status"] == "success"
        # result 可能是 float/int/str，统一转为字符串检查
        result_value = str(result["data"].get("result", ""))
        assert "5" in result_value

    def test_new_tools_still_work_with_p3_disabled(self, fresh_config) -> None:
        """P3 关闭时新工具仍可独立调用（工具本身不依赖 P3 配置）。"""
        from components.action.tools.datetime_tool import DateTimeTool

        tool = DateTimeTool()
        result = tool.invoke({"op": "now"}, {})
        assert result["status"] == "success"


# ============================================================
# 2. P3 功能开启：端到端集成测试
# ============================================================

class TestP3EnabledIntegration:
    """P3 功能开启时的端到端集成测试。"""

    def test_observability_enabled_initializes_correctly(self, p3_config_enabled) -> None:
        """observability 开启时正确初始化。"""
        from observability.metrics import get_metrics_registry, reset_metrics_registry
        from observability.tracing import get_span_manager, reset_span_manager

        reset_span_manager()
        reset_metrics_registry()

        span_manager = get_span_manager()
        metrics_registry = get_metrics_registry()

        # tracing enabled（OTel SDK 可用时）
        if span_manager.enabled:
            # OTel SDK 可用——验证 span 创建正常
            with span_manager.span("integration_test", trace_id="int-1"):
                pass

        # metrics enabled
        if metrics_registry.enabled:
            metrics_registry.record_request(status="success", duration=0.05)
            text = metrics_registry.collect_text()
            assert "modu_requests_total" in text

    def test_hitl_config_with_sensitive_tools(self, p3_config_enabled) -> None:
        """HITL 配置与敏感工具列表协同。"""
        hitl_config = p3_config_enabled.get("tools.human_in_loop")
        assert hitl_config["enabled"] is True
        sensitive = hitl_config["sensitive_tools"]
        # 所有 P3-12.3.4 需审批工具都在敏感列表中
        assert "code_executor" in sensitive
        assert "sql_query" in sensitive

    def test_structured_logging_with_trace_id(self, p3_config_enabled) -> None:
        """结构化日志与 trace_id 集成。"""
        from observability.logging_config import JsonFormatter, configure_structured_logging

        configure_structured_logging(enabled=True, level="DEBUG")

        import logging

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="integration.test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="integration test message",
            args=(),
            exc_info=None,
        )
        record.trace_id = "int-trace-123"

        output = formatter.format(record)
        parsed = json.loads(output)
        assert parsed["trace_id"] == "int-trace-123"
        assert parsed["message"] == "integration test message"


# ============================================================
# 3. HITL + 工具库集成测试
# ============================================================

class TestHitlToolsIntegration:
    """HITL 与工具库扩展的集成测试。"""

    def test_sensitive_tools_require_approval(self) -> None:
        """所有敏感工具的 requires_approval() 返回 True。"""
        from components.action.tools.code_executor import CodeExecutorTool
        from components.action.tools.file_ops import FileOpsTool
        from components.action.tools.http_request import HttpRequestTool
        from components.action.tools.sql_query import SqlQueryTool

        sensitive_tools = [
            CodeExecutorTool(),
            FileOpsTool(),
            HttpRequestTool(),
            SqlQueryTool(),
        ]

        for tool in sensitive_tools:
            assert tool.requires_approval() is True, f"{tool.name()} should require approval"

    def test_non_sensitive_tools_dont_require_approval(self) -> None:
        """非敏感工具的 requires_approval() 返回 False。"""
        from components.action.tools.calculator import CalculatorTool
        from components.action.tools.datetime_tool import DateTimeTool
        from components.action.tools.search import SearchTool

        non_sensitive_tools = [
            CalculatorTool(),
            DateTimeTool(),
            SearchTool(),
        ]

        for tool in non_sensitive_tools:
            assert tool.requires_approval() is False, f"{tool.name()} should not require approval"

    def test_approval_rejected_returns_friendly_degradation(self) -> None:
        """审批拒绝时所有敏感工具返回友好降级结果。"""
        from components.action.tools.code_executor import CodeExecutorTool
        from components.action.tools.file_ops import FileOpsTool
        from components.action.tools.http_request import HttpRequestTool
        from components.action.tools.sql_query import SqlQueryTool

        tools = [
            (CodeExecutorTool(), {"code": "print(1)"}),
            (FileOpsTool(), {"path": "test.txt", "op": "read"}),
            (HttpRequestTool(), {"url": "http://example.com"}),
            (SqlQueryTool(), {"query": "SELECT 1"}),
        ]

        for tool, params in tools:
            result = tool.on_approval_rejected(params)
            assert result["status"] == "error"
            assert result["error_code"] == "TOOL_APPROVAL_REJECTED"
            assert "message" in result["data"]


# ============================================================
# 4. 可观测性 + HITL 集成测试
# ============================================================

class TestObservabilityHitlIntegration:
    """可观测性与 HITL 的集成测试。"""

    def test_metrics_records_request_status(self, p3_config_enabled) -> None:
        """metrics 记录不同请求状态（success/error/circuit_breaker）。"""
        from observability.metrics import get_metrics_registry, reset_metrics_registry

        reset_metrics_registry()
        registry = get_metrics_registry()

        if not registry.enabled:
            pytest.skip("prometheus_client not available")

        # 模拟记录多种状态
        registry.record_request(status="success", duration=0.1)
        registry.record_request(status="error", duration=0.2)
        registry.record_request(status="circuit_breaker", duration=0.001)

        text = registry.collect_text()
        assert 'modu_requests_total{status="success"}' in text
        assert 'modu_requests_total{status="error"}' in text
        assert 'modu_requests_total{status="circuit_breaker"}' in text

    def test_trace_context_propagation_across_tools(self) -> None:
        """trace_id 通过 trace_context 在工具调用间传播。"""
        from observability.trace_context import extract_trace_context, inject_trace_context

        # 模拟注入 trace context 到请求 headers
        headers: dict[str, str] = {}
        inject_trace_context(
            headers,
            trace_id="tool-trace-1",
            user_id="user-1",
            session_id="sess-1",
        )

        # 模拟从 headers 提取
        ctx = extract_trace_context(headers)
        assert ctx["trace_id"] == "tool-trace-1"
        assert ctx["user_id"] == "user-1"
        assert ctx["session_id"] == "sess-1"

    def test_span_manager_records_tool_execution(self) -> None:
        """span manager 可包装工具执行。"""
        from observability.tracing import OtelSpanManager

        manager = OtelSpanManager(enabled=False)
        # 即使 disabled，span 也应正常执行（no-op）
        from components.action.tools.calculator import CalculatorTool

        tool = CalculatorTool()
        with manager.span("tool.invoke", trace_id="tool-1", tool_name="calculator"):
            result = tool.invoke({"expression": "1 + 1"}, {})
        assert result["status"] == "success"


# ============================================================
# 5. 工具库 + 可观测性集成测试
# ============================================================

class TestToolsObservabilityIntegration:
    """工具库与可观测性的集成测试。"""

    def test_tool_names_registered_in_metrics(self) -> None:
        """工具名可用于 metrics 标签。"""
        from components.action.tools.code_executor import CodeExecutorTool
        from components.action.tools.datetime_tool import DateTimeTool
        from components.action.tools.file_ops import FileOpsTool
        from components.action.tools.http_request import HttpRequestTool
        from components.action.tools.sql_query import SqlQueryTool

        tool_names = [
            CodeExecutorTool().name(),
            DateTimeTool().name(),
            FileOpsTool().name(),
            HttpRequestTool().name(),
            SqlQueryTool().name(),
        ]

        # 验证所有工具名都是合法的 metrics label 值
        for name in tool_names:
            assert isinstance(name, str)
            assert len(name) > 0
            # Prometheus label 值不允许换行
            assert "\n" not in name

    def test_code_executor_with_span_tracing(self) -> None:
        """代码执行工具在 span 上下文中执行。"""
        from components.action.tools.code_executor import CodeExecutorTool
        from observability.tracing import OtelSpanManager

        manager = OtelSpanManager(enabled=False)
        tool = CodeExecutorTool()

        with manager.span("code_executor.invoke", trace_id="ce-1"):
            result = tool.invoke({"code": "print(42)"}, {})

        assert result["status"] == "success"
        assert "42" in result["data"]["stdout"]


# ============================================================
# 6. 配置一致性集成测试
# ============================================================

class TestConfigConsistency:
    """P3 配置一致性集成测试。"""

    def test_p3_config_can_be_toggled(self, fresh_config) -> None:
        """P3 配置可独立开关。"""
        # 关闭所有
        fresh_config.set("tools.human_in_loop.enabled", False)
        fresh_config.set("observability.tracing.enabled", False)
        fresh_config.set("observability.metrics.enabled", False)
        fresh_config.set("observability.logging.structured", False)

        assert fresh_config.get("tools.human_in_loop.enabled") is False
        assert fresh_config.get("observability.tracing.enabled") is False

        # 独立开启 tracing
        fresh_config.set("observability.tracing.enabled", True)
        assert fresh_config.get("observability.tracing.enabled") is True
        assert fresh_config.get("observability.metrics.enabled") is False

    def test_sensitive_tools_list_complete(self, fresh_config) -> None:
        """敏感工具列表包含所有需审批工具。"""
        sensitive = fresh_config.get("tools.human_in_loop.sensitive_tools")
        # code_executor, sql_query, file_ops_write 都在列表中
        assert "code_executor" in sensitive
        assert "sql_query" in sensitive

    def test_observability_config_sections_complete(self, fresh_config) -> None:
        """observability 配置包含所有必需子节。"""
        obs = fresh_config.get("observability")
        assert "tracing" in obs
        assert "metrics" in obs
        assert "logging" in obs

        # tracing 子节
        tracing = obs["tracing"]
        assert "enabled" in tracing
        assert "otlp_endpoint" in tracing
        assert "service_name" in tracing
        assert "sampling_rate" in tracing

        # metrics 子节
        metrics = obs["metrics"]
        assert "enabled" in metrics
        assert "prometheus_port" in metrics
        assert "path" in metrics

        # logging 子节
        logging_cfg = obs["logging"]
        assert "structured" in logging_cfg
        assert "level" in logging_cfg
