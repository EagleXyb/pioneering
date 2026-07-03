"""P3-12.3.5 结构化日志模块。

提供 ``JsonFormatter``——将传统 logging 日志格式化为 JSON，
便于 ELK/Loki 等日志聚合系统消费。

设计要点：
    - **渐进迁移**：``configure_structured_logging()`` 仅在 ``observability.logging.structured=True``
      时启用 JSON 格式，默认保留原 printf 风格（符合 P3"低风险"约束）。
    - **trace_id 注入**：JSON 日志自动包含当前 OTel span 的 trace_id（若有），
      实现日志与 trace 关联。
    - **异常兼容**：格式化失败时降级为原始 message，绝不影响日志输出。
    - **可扩展**：通过 ``extra`` 字段支持业务自定义字段。
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class JsonFormatter(logging.Formatter):
    """将 LogRecord 格式化为单行 JSON。

    输出字段：
        - timestamp: ISO 8601 时间戳（UTC）
        - level: 日志级别
        - logger: logger 名称
        - message: 日志消息
        - trace_id: 链路追踪 ID（从 record.trace_id 或 OTel 当前 span 提取）
        - span_id: OTel span ID（若有）
        - module: 模块名
        - function: 函数名
        - line: 行号
        - extra: 业务自定义字段（通过 logger.info(..., extra={...}) 传入）

    异常信息：
        - exc_info: 异常堆栈字符串（若有）
    """

    # 已知的标准 LogRecord 属性，不放入 extra
    _STANDARD_ATTRS = frozenset({
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "created", "msecs", "relativeCreated", "thread", "threadName",
        "processName", "process", "message", "asctime", "taskName",
    })

    def format(self, record: logging.LogRecord) -> str:
        """将 LogRecord 格式化为 JSON 字符串。"""
        # 基础字段
        log_entry: dict[str, Any] = {
            "timestamp": self._format_time(record.created),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }

        # trace_id 注入：优先从 record 显式字段，其次从 OTel 当前 span
        trace_id = getattr(record, "trace_id", None)
        span_id = getattr(record, "span_id", None)
        if trace_id is None:
            otel_trace_id, otel_span_id = self._extract_otel_context()
            if otel_trace_id:
                trace_id = otel_trace_id
            if otel_span_id and span_id is None:
                span_id = otel_span_id
        if trace_id:
            log_entry["trace_id"] = trace_id
        if span_id:
            log_entry["span_id"] = span_id

        # 业务自定义字段（通过 extra 传入的非标准属性）
        extra: dict[str, Any] = {}
        for key, value in record.__dict__.items():
            if key not in self._STANDARD_ATTRS and not key.startswith("_"):
                try:
                    json.dumps(value, default=str)
                    extra[key] = value
                except (TypeError, ValueError):
                    extra[key] = str(value)
        if extra:
            log_entry["extra"] = extra

        # 异常信息
        if record.exc_info:
            log_entry["exc_info"] = self.formatException(record.exc_info)
        if record.stack_info:
            log_entry["stack_info"] = self.formatStack(record.stack_info)

        # 序列化为单行 JSON（ensure_ascii=False 支持中文）
        try:
            return json.dumps(log_entry, ensure_ascii=False, default=str)
        except Exception:  # noqa: BLE001
            # 序列化失败时降级为纯文本
            return f"{log_entry['timestamp']} [{log_entry['level']}] {log_entry['logger']}: {log_entry['message']}"

    @staticmethod
    def _format_time(created: float) -> str:
        """将 time.time() 转为 ISO 8601 字符串（含毫秒）。"""
        # 使用 localtime 与日志默认行为一致
        lt = time.localtime(created)
        milliseconds = int((created - int(created)) * 1000)
        return time.strftime("%Y-%m-%dT%H:%M:%S", lt) + f".{milliseconds:03d}"

    @staticmethod
    def _extract_otel_context() -> tuple[Optional[str], Optional[str]]:
        """从当前 OTel span 提取 trace_id 和 span_id。

        Returns:
            (trace_id, span_id) 元组，无 span 时均为 None
        """
        try:
            from opentelemetry import trace

            span = trace.get_current_span()
            ctx = span.get_span_context()
            if ctx and ctx.is_valid:
                # trace_id 是 int，转为 32 字符十六进制字符串
                trace_id = f"{ctx.trace_id:032x}"
                span_id = f"{ctx.span_id:016x}"
                return trace_id, span_id
        except Exception:  # noqa: BLE001
            pass
        return None, None


def configure_structured_logging(
    enabled: Optional[bool] = None,
    level: Optional[str] = None,
) -> None:
    """配置全局结构化日志。

    当 ``enabled=True`` 时，将 root logger 的 handler 替换为 JsonFormatter。
    当 ``enabled=False`` 时，恢复默认 printf 风格格式。

    Args:
        enabled: 是否启用结构化日志。None=从 RuntimeConfig 读取
        level: 日志级别（如 "INFO"/"DEBUG"）。None=从 RuntimeConfig 读取
    """
    if enabled is None or level is None:
        try:
            from config.runtime_config import get_config

            config = get_config()
            if enabled is None:
                enabled = bool(config.get("observability.logging.structured", False))
            if level is None:
                level = str(config.get("observability.logging.level", "INFO"))
        except Exception:  # noqa: BLE001
            if enabled is None:
                enabled = False
            if level is None:
                level = "INFO"

    root_logger = logging.getLogger()
    log_level = getattr(logging, level.upper() if level else "INFO", logging.INFO)
    root_logger.setLevel(log_level)

    # 清理现有 handler（避免重复输出）
    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)

    # 创建新 handler
    handler = logging.StreamHandler()
    if enabled:
        handler.setFormatter(JsonFormatter())
    else:
        # 默认格式：2026-01-01 12:00:00 INFO module:function:line - message
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s %(levelname)s %(name)s:%(funcName)s:%(lineno)d - %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
    root_logger.addHandler(handler)

    # 同时配置 uvicorn/celery 等第三方 logger（若存在）
    for third_party_name in ("uvicorn", "uvicorn.access", "celery"):
        third_logger = logging.getLogger(third_party_name)
        third_logger.handlers.clear()
        third_logger.addHandler(handler)
        third_logger.setLevel(log_level)

    logger.info(
        "Structured logging configured: enabled=%s level=%s",
        enabled, level,
    )


def get_log_level_int(level: str) -> int:
    """将字符串日志级别转为 logging 模块常量。

    Args:
        level: 字符串级别（如 "INFO"）

    Returns:
        logging 模块常量（如 logging.INFO）
    """
    return getattr(logging, level.upper(), logging.INFO)
