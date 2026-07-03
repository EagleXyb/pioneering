"""P3-12.3.5 OTel/Prometheus exporter 配置模块。

提供：
    - ``configure_otlp_exporter()``: 配置 OTLP gRPC exporter，将 span 导出到 OTLP endpoint
    - ``start_prometheus_server()``: 启动 Prometheus HTTP endpoint，暴露 metrics

设计要点：
    - **懒加载**：exporter 只在调用时配置，避免模块导入即副作用。
    - **幂等性**：重复调用 ``configure_otlp_exporter`` 只会添加一个新的 span processor，
      不会重复创建（内部用 flag 控制）。
    - **优雅降级**：OTLP endpoint 为空或连接失败时，仅记录 warning，不抛异常。
    - **端口冲突处理**：``start_prometheus_server`` 端口被占用时返回 None 而非崩溃。
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Optional

logger = logging.getLogger(__name__)

# 防止重复配置
_otlp_configured: bool = False
_otlp_lock = threading.Lock()

# 持有 prometheus_server 实例引用，避免被 GC
_prometheus_server: Any = None
_prometheus_lock = threading.Lock()


def configure_otlp_exporter(
    endpoint: str,
    service_name: str = "modu-agent",
) -> bool:
    """配置 OTLP gRPC exporter，将 OTel span 导出到指定 endpoint。

    内部会创建 ``OTLPSpanExporter`` + ``BatchSpanProcessor``，
    并添加到全局 TracerProvider。

    Args:
        endpoint: OTLP gRPC endpoint（如 "http://localhost:4317"）
        service_name: 服务名（用于日志，实际 service.name 在 TracerProvider 初始化时设置）

    Returns:
        True=配置成功，False=配置失败或已配置
    """
    global _otlp_configured

    if not endpoint:
        logger.debug("configure_otlp_exporter: endpoint empty, skipping")
        return False

    with _otlp_lock:
        if _otlp_configured:
            logger.debug("configure_otlp_exporter: already configured, skipping")
            return True

        try:
            from opentelemetry import trace
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
                OTLPSpanExporter,
            )
            from opentelemetry.sdk.trace.export import BatchSpanProcessor

            provider = trace.get_tracer_provider()

            # 仅当 provider 是 SDK 的 TracerProvider 时才可添加 processor
            # （如果是 ProxyTracerProvider 或 None，则无法导出）
            from opentelemetry.sdk.trace import TracerProvider as SDKTracerProvider

            if not isinstance(provider, SDKTracerProvider):
                # 可能 tracing 未启用或 provider 是默认 ProxyTracerProvider
                # 尝试创建一个新的 TracerProvider
                from opentelemetry.sdk.resources import Resource

                resource = Resource.create({"service.name": service_name})
                new_provider = SDKTracerProvider(resource=resource)
                try:
                    trace.set_tracer_provider(new_provider)
                except Exception:  # noqa: BLE001
                    # 已设置过 provider，复用现有
                    pass
                provider = trace.get_tracer_provider()
                if not isinstance(provider, SDKTracerProvider):
                    logger.warning(
                        "configure_otlp_exporter: cannot attach span processor "
                        "to provider %s (tracing may not be enabled)",
                        type(provider).__name__,
                    )
                    return False

            exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
            span_processor = BatchSpanProcessor(
                exporter,
                # 批量导出配置（默认值，可按需调整）
                max_queue_size=512,
                schedule_delay_millis=5000,
                max_export_batch_size=128,
            )
            provider.add_span_processor(span_processor)

            _otlp_configured = True
            logger.info(
                "OTLP exporter configured: endpoint=%s service=%s",
                endpoint, service_name,
            )
            return True

        except ImportError as e:
            logger.warning(
                "configure_otlp_exporter: opentelemetry-exporter-otlp not installed: %s",
                e,
            )
            return False
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "configure_otlp_exporter: configuration failed: %s",
                e,
            )
            return False


def start_prometheus_server(
    port: int = 9090,
    path: str = "/metrics",
    registry: Any = None,
) -> Optional[Any]:
    """启动 Prometheus HTTP endpoint，暴露 metrics。

    启动后访问 ``http://localhost:{port}{path}`` 可获取 Prometheus exposition 格式的指标。

    Args:
        port: HTTP 端口（默认 9090）
        path: URL 路径（默认 "/metrics"）
        registry: prometheus_client CollectorRegistry 实例。
                  None=使用 MetricsRegistry 的 registry。

    Returns:
        prometheus_server 实例（成功时），None=启动失败（如端口被占用）

    Note:
        - 在同一进程内只能启动一个 prometheus_server，重复调用返回 None。
        - 测试环境下建议用 ``prometheus_client.generate_latest`` 直接读取，
          而非启动 HTTP server。
    """
    global _prometheus_server

    with _prometheus_lock:
        if _prometheus_server is not None:
            logger.debug("start_prometheus_server: already running, skipping")
            return _prometheus_server

        try:
            from prometheus_client import (
                CollectorRegistry,
                start_http_server,
            )
        except ImportError as e:
            logger.warning(
                "start_prometheus_server: prometheus_client not installed: %s",
                e,
            )
            return None

        # 确定使用的 registry
        if registry is None:
            try:
                from observability.metrics import get_metrics_registry

                metrics_registry = get_metrics_registry()
                registry = metrics_registry.registry
            except Exception:  # noqa: BLE001
                pass

        if registry is None:
            logger.warning(
                "start_prometheus_server: no metrics registry available "
                "(metrics may be disabled)"
            )
            return None

        try:
            # start_http_server 返回 (server, thread) 元组
            server_info = start_http_server(port=port, registry=registry)
            _prometheus_server = server_info
            logger.info(
                "Prometheus server started: port=%d path=%s",
                port, path,
            )
            return _prometheus_server
        except OSError as e:
            # 端口被占用
            logger.warning(
                "start_prometheus_server: port %d unavailable: %s",
                port, e,
            )
            return None
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "start_prometheus_server: start failed: %s",
                e,
            )
            return None


def stop_prometheus_server() -> None:
    """停止 Prometheus HTTP server（测试清理用）。"""
    global _prometheus_server

    with _prometheus_lock:
        if _prometheus_server is None:
            return

        try:
            # start_http_server 返回 (server, thread)
            server, thread = _prometheus_server
            if hasattr(server, "shutdown"):
                server.shutdown()
            if hasattr(server, "server_close"):
                server.server_close()
            if thread.is_alive():
                thread.join(timeout=2.0)
        except Exception as e:  # noqa: BLE001
            logger.debug("stop_prometheus_server: %s", e)

        _prometheus_server = None


def reset_exporters() -> None:
    """重置所有 exporter 状态（测试清理用）。

    同时停止 prometheus server 并重置 OTLP 配置标志。
    """
    stop_prometheus_server()

    global _otlp_configured
    with _otlp_lock:
        _otlp_configured = False
