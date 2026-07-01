"""重试包装器（P2-8）：为工具调用与 LLM 调用提供指数退避重试。

设计目标：
    - 工具调用：在 `wrap_modu_tool._invoke` 内嵌入重试循环，保持 StructuredTool 类型不变
    - LLM 调用：优先使用 LangChain `Runnable.with_retry()`，不可用时降级为无重试

仅重试瞬时故障（网络/超时/5xx），不重试参数错误或客户端错误（4xx），
避免对必然失败的请求做无意义重试。

配置项（runtime_config）：
    tools.retry.max_attempts = 3       # 工具调用最大尝试次数（含首次）
    tools.retry.base_delay   = 0.5     # 指数退避基础延迟（秒）
    tools.retry.max_delay    = 5.0     # 单次延迟上限（秒）
    llm.retry.max_attempts   = 2       # LLM 调用最大尝试次数
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Tuple, Type

logger = logging.getLogger(__name__)


def _get_retryable_exceptions() -> Tuple[Type[BaseException], ...]:
    """收集可重试的异常类型。

    包含：
        - TimeoutError / ConnectionError / OSError（标准库网络异常）
        - httpx.TransportError（httpx 网络层异常）
        - openai.APIStatusError（5xx 服务器错误，需运行时判断 status_code）

    不包含：
        - ValueError / TypeError / KeyError（参数错误）
        - openai.BadRequestError / AuthenticationError（4xx 客户端错误）
    """
    exceptions: list = [TimeoutError, ConnectionError, OSError]

    try:
        import httpx  # noqa: F401
        # httpx.TransportError 是所有传输层异常的基类（ConnectError, ReadTimeout 等）
        exceptions.append(httpx.TransportError)
    except ImportError:
        pass

    try:
        # openai 的 5xx 异常（APIError 的子类）
        # 不直接重试 APIStatusError，因为它可能是 4xx；在 _is_retryable_status 中判断
        from openai import APIError  # noqa: F401
        exceptions.append(APIError)
    except ImportError:
        pass

    return tuple(exceptions)


def _is_retryable_exception(exc: BaseException) -> bool:
    """判断异常是否可重试。

    对于 openai.APIStatusError，只重试 5xx 和 429（RateLimit）；
    其他可重试异常（TimeoutError 等）直接返回 True。
    """
    # openai APIStatusError：根据 status_code 判断
    status_code = getattr(exc, "status_code", None)
    if status_code is not None:
        # 429 RateLimit 或 5xx Server Error → 可重试
        # 4xx Client Error（除 429）→ 不可重试
        return status_code == 429 or status_code >= 500

    retryable_types = _get_retryable_exceptions()
    return isinstance(exc, retryable_types)


def with_tool_retry(
    func: Callable[..., Any],
    tool_name: str,
    config: Any,
) -> Callable[..., Any]:
    """包装工具 invoke 函数，添加指数退避重试。

    用于 `wrap_modu_tool` 内部，保持返回值为 StructuredTool（不改变类型）。

    Args:
        func: 原始 _invoke 函数（同步）
        tool_name: 工具名（用于日志）
        config: RuntimeConfig 实例

    Returns:
        带重试的 _invoke 函数
    """
    retry_cfg = config.get("tools.retry", {}) if config else {}
    max_attempts = int(retry_cfg.get("max_attempts", 3))
    base_delay = float(retry_cfg.get("base_delay", 0.5))
    max_delay = float(retry_cfg.get("max_delay", 5.0))

    if max_attempts <= 1:
        return func

    def _invoke_with_retry(**kwargs: Any) -> Any:
        """带指数退避重试的 invoke。"""
        last_exc: BaseException | None = None
        for attempt in range(max_attempts):
            try:
                return func(**kwargs)
            except Exception as e:
                if not _is_retryable_exception(e):
                    # 不可重试异常（参数错误等），立即抛出
                    raise
                last_exc = e
                if attempt < max_attempts - 1:
                    # 指数退避：base_delay * 2^attempt，钳制到 max_delay
                    delay = min(base_delay * (2 ** attempt), max_delay)
                    logger.warning(
                        "Tool '%s' attempt %d/%d failed (%s: %s), retrying in %.2fs",
                        tool_name,
                        attempt + 1,
                        max_attempts,
                        type(e).__name__,
                        str(e)[:200],
                        delay,
                    )
                    time.sleep(delay)
                else:
                    logger.error(
                        "Tool '%s' exhausted %d attempts, last error: %s",
                        tool_name,
                        max_attempts,
                        str(e)[:200],
                    )
        # 理论不可达（循环内必 return 或 raise），但作为保险
        if last_exc is not None:
            raise last_exc
        raise RuntimeError(f"Tool '{tool_name}' retry loop exited unexpectedly")

    return _invoke_with_retry


def apply_llm_retry(llm: Any, config: Any) -> Any:
    """为 LangChain ChatModel 应用重试。

    优先使用 LangChain 的 `Runnable.with_retry()` 方法（需 langchain_core 支持），
    不可用时降级为无重试并记录警告。

    Args:
        llm: ChatModel 实例（如 ChatOpenAI）
        config: RuntimeConfig 实例

    Returns:
        带重试的 Runnable，或原 llm（降级时）
    """
    retry_cfg = config.get("llm.retry", {}) if config else {}
    max_attempts = int(retry_cfg.get("max_attempts", 2))

    if max_attempts <= 1:
        return llm

    retryable_types = _get_retryable_exceptions()

    try:
        return llm.with_retry(
            retry_if_exception_type=retryable_types,
            stop_after_attempt=max_attempts,
            wait_exponential_jitter=True,
        )
    except Exception as e:
        logger.warning(
            "Failed to apply with_retry to LLM (%s), running without retry: %s",
            type(llm).__name__,
            str(e),
        )
        return llm
