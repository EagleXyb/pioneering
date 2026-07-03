"""P3-12.3.5 Prometheus metrics 模块。

提供 ``MetricsRegistry``——封装 prometheus_client 的 Counter/Histogram/Gauge，
集中管理 ModuAgent 的关键业务指标。

设计要点：
    - **独立 Registry**：使用 ``CollectorRegistry()`` 而非全局默认 registry，
      避免测试间指标冲突（prometheus_client 全局 registry 在同一进程内不可重置）。
    - **优雅降级**：metrics 未启用或 prometheus_client 未安装时，
      ``record_*`` 方法退化为无操作，不影响业务流程。
    - **单例管理**：``get_metrics_registry()`` 返回全局唯一实例。
    - **指标定义**（与技术方案 §4.2.4 一致）：
        - ``modu_requests_total`` (Counter, labels=["status"]): 请求计数
        - ``modu_request_duration_seconds`` (Histogram): 请求延迟分布
        - ``modu_evolution_total`` (Counter): 进化触发次数
        - ``modu_consensus_failures_total`` (Counter): 共识失败次数
        - ``modu_active_sessions`` (Gauge): 活跃会话数
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# 全局单例
_metrics_registry: Optional["MetricsRegistry"] = None


def _is_metrics_config_enabled() -> bool:
    """从 RuntimeConfig 读取 metrics.enabled 配置（异常时返回 False）。"""
    try:
        from config.runtime_config import get_config

        return bool(get_config().get("observability.metrics.enabled", False))
    except Exception:  # noqa: BLE001
        return False


class MetricsRegistry:
    """Prometheus 指标注册中心。

    封装 prometheus_client 的 Counter/Histogram/Gauge，提供业务语义化的指标记录接口。
    当 metrics 未启用时，所有 ``record_*`` 方法退化为无操作。

    Usage::

        registry = get_metrics_registry()
        registry.record_request(status="success", duration=0.5)
        registry.record_evolution()
        registry.inc_active_sessions()
        registry.dec_active_sessions()
    """

    def __init__(self, enabled: Optional[bool] = None) -> None:
        """初始化 Prometheus 指标。

        Args:
            enabled: 是否启用 metrics。None=从 RuntimeConfig 读取，True/False=显式控制
        """
        if enabled is None:
            enabled = _is_metrics_config_enabled()
        self._enabled = enabled

        self._registry: Any = None
        self._qps: Any = None
        self._latency: Any = None
        self._evolution_count: Any = None
        self._consensus_failures: Any = None
        self._active_sessions: Any = None

        if not enabled:
            logger.debug("MetricsRegistry: metrics disabled (no-op mode)")
            return

        try:
            from prometheus_client import (
                CollectorRegistry,
                Counter,
                Gauge,
                Histogram,
            )

            self._registry = CollectorRegistry()

            self._qps = Counter(
                "modu_requests_total",
                "Total number of ModuAgent requests",
                ["status"],
                registry=self._registry,
            )
            self._latency = Histogram(
                "modu_request_duration_seconds",
                "Request latency in seconds",
                registry=self._registry,
            )
            self._evolution_count = Counter(
                "modu_evolution_total",
                "Total number of evolution triggers",
                registry=self._registry,
            )
            self._consensus_failures = Counter(
                "modu_consensus_failures_total",
                "Total number of consensus failures",
                registry=self._registry,
            )
            self._active_sessions = Gauge(
                "modu_active_sessions",
                "Number of active sessions",
                registry=self._registry,
            )
            logger.info("MetricsRegistry: metrics enabled")
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "MetricsRegistry: init failed, falling back to no-op: %s",
                e,
            )
            self._enabled = False
            self._registry = None

    @property
    def enabled(self) -> bool:
        """是否启用 metrics。"""
        return self._enabled and self._registry is not None

    @property
    def registry(self) -> Any:
        """底层 prometheus_client CollectorRegistry（None=未启用）。"""
        return self._registry

    def record_request(self, status: str = "success", duration: Optional[float] = None) -> None:
        """记录一次请求。

        Args:
            status: 请求状态（success/error/timeout/circuit_breaker 等）
            duration: 请求耗时（秒），None=不记录延迟
        """
        if not self.enabled:
            return
        try:
            self._qps.labels(status=status).inc()
            if duration is not None:
                self._latency.observe(duration)
        except Exception as e:  # noqa: BLE001
            logger.debug("record_request failed: %s", e)

    def record_evolution(self) -> None:
        """记录一次进化触发。"""
        if not self.enabled:
            return
        try:
            self._evolution_count.inc()
        except Exception as e:  # noqa: BLE001
            logger.debug("record_evolution failed: %s", e)

    def record_consensus_failure(self) -> None:
        """记录一次共识失败。"""
        if not self.enabled:
            return
        try:
            self._consensus_failures.inc()
        except Exception as e:  # noqa: BLE001
            logger.debug("record_consensus_failure failed: %s", e)

    def inc_active_sessions(self) -> None:
        """活跃会话数 +1。"""
        if not self.enabled:
            return
        try:
            self._active_sessions.inc()
        except Exception as e:  # noqa: BLE001
            logger.debug("inc_active_sessions failed: %s", e)

    def dec_active_sessions(self) -> None:
        """活跃会话数 -1。"""
        if not self.enabled:
            return
        try:
            self._active_sessions.dec()
        except Exception as e:  # noqa: BLE001
            logger.debug("dec_active_sessions failed: %s", e)

    def set_active_sessions(self, value: int) -> None:
        """设置活跃会话数绝对值。"""
        if not self.enabled:
            return
        try:
            self._active_sessions.set(value)
        except Exception as e:  # noqa: BLE001
            logger.debug("set_active_sessions failed: %s", e)

    def collect_text(self) -> str:
        """以 Prometheus exposition format 输出所有指标（供 HTTP endpoint 使用）。

        Returns:
            指标文本（未启用时返回空字符串）
        """
        if not self.enabled:
            return ""
        try:
            from prometheus_client import generate_latest

            return generate_latest(self._registry).decode("utf-8")
        except Exception as e:  # noqa: BLE001
            logger.debug("collect_text failed: %s", e)
            return ""


def get_metrics_registry() -> MetricsRegistry:
    """获取全局 ``MetricsRegistry`` 单例。

    首次调用时懒初始化；后续调用返回同一实例。

    Returns:
        全局 MetricsRegistry 实例
    """
    global _metrics_registry
    if _metrics_registry is None:
        _metrics_registry = MetricsRegistry()
    return _metrics_registry


def is_metrics_enabled() -> bool:
    """检查 metrics 是否实际启用（配置 + prometheus_client 初始化均成功）。"""
    try:
        return get_metrics_registry().enabled
    except Exception:  # noqa: BLE001
        return False


def reset_metrics_registry() -> None:
    """重置全局 metrics registry 单例（测试清理用）。"""
    global _metrics_registry
    _metrics_registry = None
