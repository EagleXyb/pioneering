"""P3-12.3.5 OpenTelemetry tracing 模块。

提供 ``OtelSpanManager``——替代 [runner.py:_span](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/langgraph/runner.py)
的轻量级 span 埋点，升级为 OTel span。

设计要点：
    - **签名兼容**：``span(name, trace_id, **attributes)`` 与原 ``_span`` 完全一致，
      便于 runner.py 一行替换。
    - **优雅降级**：tracing 未启用或 OTel 未配置时，``span()`` 退化为无操作 contextmanager，
      不影响现有流程（符合 P3"低风险"约束）。
    - **单例管理**：``get_span_manager()`` 返回全局唯一实例；``reset_span_manager()`` 供测试清理。
    - **OTel TracerProvider 兼容**：OTel 的 ``set_tracer_provider`` 在同一进程内只能调用一次，
      重复调用会抛 ``RuntimeWarning``——本模块捕获并忽略该告警。
"""
from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Any, Iterator, Optional

logger = logging.getLogger(__name__)

# 全局单例（首次访问时懒初始化）
_span_manager: Optional["OtelSpanManager"] = None


def _is_tracing_config_enabled() -> bool:
    """从 RuntimeConfig 读取 tracing.enabled 配置（异常时返回 False）。"""
    try:
        from config.runtime_config import get_config

        return bool(get_config().get("observability.tracing.enabled", False))
    except Exception:  # noqa: BLE001
        return False


class OtelSpanManager:
    """OTel TracerProvider 封装，提供与原 ``_span`` 兼容的 span contextmanager。

    Attributes:
        _provider: OTel TracerProvider 实例（None=tracing 未启用）
        _tracer: OTel Tracer 实例（None=tracing 未启用）

    用法::

        with manager.span("run_sync", trace_id="abc", user_id="u1"):
            ...

    当 tracing 未启用时，``span()`` 退化为无操作 contextmanager（仅记录日志）。
    """

    def __init__(self, service_name: str = "modu-agent", enabled: Optional[bool] = None) -> None:
        """初始化 OTel TracerProvider。

        Args:
            service_name: 服务名（用作 OTel resource 属性）
            enabled: 是否启用 tracing。None=从 RuntimeConfig 读取，True/False=显式控制
        """
        self._service_name = service_name
        if enabled is None:
            enabled = _is_tracing_config_enabled()
        self._enabled = enabled

        self._provider: Any = None
        self._tracer: Any = None

        if not enabled:
            logger.debug("OtelSpanManager: tracing disabled (no-op mode)")
            return

        try:
            from opentelemetry import trace
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.sdk.trace import TracerProvider

            resource = Resource.create(
                {"service.name": service_name}
            )
            provider = TracerProvider(resource=resource)
            # set_tracer_provider 只能调用一次，重复调用会抛 RuntimeWarning
            try:
                trace.set_tracer_provider(provider)
            except Exception as e:  # noqa: BLE001
                # 可能是"TracerProvider already set"——这种情况下复用全局 provider
                logger.debug("set_tracer_provider skipped (likely already set): %s", e)
                try:
                    provider.shutdown()
                except Exception:  # noqa: BLE001
                    pass
                provider = None  # 不持有本地引用，使用全局 tracer

            self._provider = provider
            self._tracer = trace.get_tracer(service_name)
            logger.info(
                "OtelSpanManager: tracing enabled (service=%s)",
                service_name,
            )
        except Exception as e:  # noqa: BLE001
            # OTel 未安装或初始化失败——退化为无操作模式
            logger.warning(
                "OtelSpanManager: tracing init failed, falling back to no-op: %s",
                e,
            )
            self._enabled = False
            self._provider = None
            self._tracer = None

    @property
    def enabled(self) -> bool:
        """是否启用 tracing。"""
        return self._enabled and self._tracer is not None

    @contextmanager
    def span(
        self,
        name: str,
        trace_id: str = "",
        **attributes: Any,
    ) -> Iterator[None]:
        """与原 ``runner._span`` 签名兼容的 OTel span contextmanager。

        Args:
            name: span 名称（如 "run_sync"）
            trace_id: 链路追踪 ID（业务层）
            **attributes: span 属性（如 user_id, session_id）

        Yields:
            None（在 span 上下文中执行代码块）

        Note:
            tracing 未启用时退化为无操作（仅记录日志），保持与原 ``_span`` 行为一致。
        """
        if not self.enabled or self._tracer is None:
            # 降级：无操作（保留原 _span 的日志记录行为，便于排障）
            start = time.perf_counter()
            attrs = {"trace_id": trace_id, **attributes}
            logger.debug("span.noop.start: %s attrs=%s", name, attrs)
            try:
                yield
            except Exception as e:
                elapsed_ms = (time.perf_counter() - start) * 1000
                logger.error(
                    "span.noop.error: %s elapsed=%.2fms error=%s attrs=%s",
                    name, elapsed_ms, str(e), attrs,
                )
                raise
            else:
                elapsed_ms = (time.perf_counter() - start) * 1000
                logger.debug(
                    "span.noop.end: %s elapsed=%.2fms attrs=%s",
                    name, elapsed_ms, attrs,
                )
            return

        # 正常路径：创建 OTel span
        from opentelemetry import trace as _otel_trace
        from opentelemetry.trace import Status, StatusCode

        with self._tracer.start_as_current_span(name) as otel_span:
            # 注入业务属性
            if trace_id:
                otel_span.set_attribute("trace_id", trace_id)
            for k, v in attributes.items():
                try:
                    otel_span.set_attribute(k, v)
                except Exception:  # noqa: BLE001
                    # 非法属性值（如自定义对象）——降级为字符串
                    otel_span.set_attribute(k, str(v))

            start = time.perf_counter()
            try:
                yield
            except Exception as e:
                elapsed_ms = (time.perf_counter() - start) * 1000
                otel_span.record_exception(e)
                otel_span.set_status(Status(StatusCode.ERROR, str(e)))
                otel_span.set_attribute("elapsed_ms", elapsed_ms)
                logger.error(
                    "span.error: %s elapsed=%.2fms error=%s attrs=%s",
                    name, elapsed_ms, str(e),
                    {"trace_id": trace_id, **attributes},
                )
                raise
            else:
                elapsed_ms = (time.perf_counter() - start) * 1000
                otel_span.set_attribute("elapsed_ms", elapsed_ms)
                logger.debug(
                    "span.end: %s elapsed=%.2fms attrs=%s",
                    name, elapsed_ms,
                    {"trace_id": trace_id, **attributes},
                )


def get_span_manager(service_name: str = "modu-agent") -> OtelSpanManager:
    """获取全局 ``OtelSpanManager`` 单例。

    首次调用时懒初始化；后续调用返回同一实例。
    配置变更需调用 ``reset_span_manager()`` 后再次获取以重新初始化。

    Args:
        service_name: 服务名（仅首次初始化时生效）

    Returns:
        全局 OtelSpanManager 实例
    """
    global _span_manager
    if _span_manager is None:
        _span_manager = OtelSpanManager(service_name=service_name)
    return _span_manager


def reset_span_manager() -> None:
    """重置全局 span manager 单例（测试清理用）。

    会尝试关闭底层 OTel TracerProvider 的导出器。
    """
    global _span_manager
    if _span_manager is not None:
        provider = getattr(_span_manager, "_provider", None)
        if provider is not None:
            try:
                provider.shutdown()
            except Exception:  # noqa: BLE001
                pass
    _span_manager = None


def is_tracing_enabled() -> bool:
    """检查 tracing 是否实际启用（配置 + OTel 初始化均成功）。"""
    try:
        return get_span_manager().enabled
    except Exception:  # noqa: BLE001
        return False
