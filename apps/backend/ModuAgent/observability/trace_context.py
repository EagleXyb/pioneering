"""P3-12.3.5 OTel trace context 注入/提取模块。

提供跨服务/跨进程的 trace_id 传播能力，使分布式追踪能够贯通调用链。

设计要点：
    - **基于 OTel propagators**：复用 OTel 标准的 ``propagate`` API，
      默认使用 ``tracecontext``（W3C Trace Context）+ ``baggage`` propagator。
    - **业务 trace_id 兼容**：ModuAgent 的 ``state.trace_id``（业务层 UUID）与
      OTel 的 ``trace_id``（128-bit hex）是两个独立概念——本模块同时传播两者：
        - OTel span context 通过 W3C ``traceparent`` header 传播
        - 业务 trace_id 通过自定义 ``x-modu-trace-id`` header 传播
    - **优雅降级**：OTel 未初始化时，仅传播业务 trace_id（无 OTel span）。
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# 业务层 trace_id 的 header 名
_MODU_TRACE_ID_HEADER = "x-modu-trace-id"
_MODU_USER_ID_HEADER = "x-modu-user-id"
_MODU_SESSION_ID_HEADER = "x-modu-session-id"


def inject_trace_context(
    headers: Dict[str, str],
    trace_id: str = "",
    user_id: str = "",
    session_id: str = "",
) -> Dict[str, str]:
    """将 trace context 注入到 headers 字典（用于跨服务调用）。

    同时注入：
        - OTel W3C traceparent/baggage（若当前有活跃 span）
        - 业务层 trace_id/user_id/session_id（自定义 header）

    Args:
        headers: 待注入的 headers 字典（会被原地修改并返回）
        trace_id: 业务层 trace_id（与 OTel trace_id 独立）
        user_id: 用户 ID
        session_id: 会话 ID

    Returns:
        注入后的 headers 字典（与入参同一对象）
    """
    # 1. 注入业务层字段
    if trace_id:
        headers[_MODU_TRACE_ID_HEADER] = trace_id
    if user_id:
        headers[_MODU_USER_ID_HEADER] = user_id
    if session_id:
        headers[_MODU_SESSION_ID_HEADER] = session_id

    # 2. 注入 OTel W3C trace context
    try:
        from opentelemetry import propagate

        # propagate.inject 接受 setter，默认操作 dict
        # 使用 carrier=dict 的方式：opentelemetry 默认 dict getter/setter
        # 但我们的 headers 已是 dict，可直接注入
        # OTel 默认 propagator 是 TraceContextTextMapPropagator + BaggagePropagator
        # 它会读取当前 active span 并写入 "traceparent" header
        propagate.inject(headers)
    except Exception as e:  # noqa: BLE001
        logger.debug("OTel context injection failed (likely no active span): %s", e)

    return headers


def extract_trace_context(headers: Dict[str, str]) -> Dict[str, Any]:
    """从 headers 字典提取 trace context。

    提取内容：
        - OTel span context（若有），并设为当前 active span（用于后续 span 继承）
        - 业务层 trace_id/user_id/session_id

    Args:
        headers: 包含 trace context 的 headers 字典

    Returns:
        提取的上下文字典，包含：
            - trace_id: 业务层 trace_id（字符串，可能为空）
            - user_id: 用户 ID（字符串，可能为空）
            - session_id: 会话 ID（字符串，可能为空）
            - otel_context: OTel Context 对象（None=无 OTel span）
    """
    result: Dict[str, Any] = {
        "trace_id": "",
        "user_id": "",
        "session_id": "",
        "otel_context": None,
    }

    # 1. 提取业务层字段
    result["trace_id"] = headers.get(_MODU_TRACE_ID_HEADER, "")
    result["user_id"] = headers.get(_MODU_USER_ID_HEADER, "")
    result["session_id"] = headers.get(_MODU_SESSION_ID_HEADER, "")

    # 2. 提取 OTel context（不自动设为 active，避免副作用）
    try:
        from opentelemetry import propagate

        context = propagate.extract(headers)
        if context:
            result["otel_context"] = context
    except Exception as e:  # noqa: BLE001
        logger.debug("OTel context extraction failed: %s", e)

    return result


def attach_otel_context(context: Any) -> Optional[Any]:
    """将提取的 OTel context 设为当前 active context。

    返回一个 detach token，调用 ``detach(token)`` 可恢复原 context。
    通常用于：从 headers 提取 context 后，在处理请求前 attach，
    处理完成后 detach。

    Args:
        context: 从 ``extract_trace_context`` 获取的 otel_context

    Returns:
        detach token（None=无需 detach，context 为空或 attach 失败）
    """
    if context is None:
        return None
    try:
        from opentelemetry import context as otel_context_mod

        return otel_context_mod.attach(context)
    except Exception as e:  # noqa: BLE001
        logger.debug("OTel context attach failed: %s", e)
        return None


def detach_otel_context(token: Any) -> None:
    """恢复原 OTel context（与 ``attach_otel_context`` 配对使用）。

    Args:
        token: ``attach_otel_context`` 返回的 token
    """
    if token is None:
        return
    try:
        from opentelemetry import context as otel_context_mod

        otel_context_mod.detach(token)
    except Exception as e:  # noqa: BLE001
        logger.debug("OTel context detach failed: %s", e)
