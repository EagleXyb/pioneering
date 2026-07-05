"""ModuAgent LangGraph 运行入口（流式/非流式）。

P0-2: LangGraph 成为唯一引擎，移除 legacy Coordinator 分支。

提供：
    - stream_response(): 流式调用，使用 LangGraph astream
    - run_sync(): 非流式调用
    - get_runner(): 获取 LangGraph CompiledStateGraph 实例
    - process_request_compat(): 统一调用接口（保留向后兼容）

LangGraph 提供 4 种 stream_mode：
    - messages: token 级流式
    - updates: 节点状态更新
    - values: 完整状态快照
    - custom: 自定义事件
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import uuid
from contextlib import contextmanager
from typing import Any, AsyncGenerator, Dict, Iterator, Optional

from langgraph.graph.state import CompiledStateGraph

from config.runtime_config import get_config
from config.schemas import PerceptionInputSchema
from modu_graph.adapters.event_bridge import LangGraphEventBridge
from modu_graph.state import ModuAgentState, make_initial_state
from orchestration.communication.protocol import ErrorCode

logger = logging.getLogger(__name__)


# P1-12.2.6: CompiledStateGraph 实例缓存，避免每次 get_runner() 都重建图。
# 配置变更（通过 hash 检测）时自动失效重建。
_runner_cache: Optional[Any] = None
_runner_config_hash: Optional[str] = None
_runner_cache_lock = threading.Lock()

# P2-12.2.4: 配置热更新主动传导——回调注册标志
_config_callback_registered: bool = False
_config_callback_lock = threading.Lock()

# P2-12.2.4: 触发图重建的配置 key 前缀
_GRAPH_REBUILD_PREFIXES = ("llm.", "tools.", "memory.", "orchestration.", "streaming.")


def _hash_config(config: Any) -> str:
    """P1-12.2.6: 计算运行时配置的哈希，用于判断是否需要重建图。

    Args:
        config: RuntimeConfig 实例

    Returns:
        配置内容的 SHA256 十六进制摘要
    """
    try:
        data = config.as_dict()
    except Exception:
        data = {}
    return hashlib.sha256(
        json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    ).hexdigest()


@contextmanager
def _span(
    name: str,
    trace_id: str = "",
    **attributes: Any,
) -> Iterator[None]:
    """P2-9 + P3-12.3.5: span 埋点，支持 OTel 升级。

    P3-12.3.5: 委托给 ``observability.tracing.OtelSpanManager.span()``：
        - 当 ``observability.tracing.enabled=True`` 时创建 OTel span（支持分布式追踪）
        - 当 tracing 未启用时退化为日志记录（与 P2-9 行为一致，零侵入）

    向后兼容：签名与 P2-9 完全一致，所有调用方无需修改。

    Args:
        name: span 名称（如 "run_sync", "stream_response"）
        trace_id: 链路追踪 ID
        **attributes: span 属性（如 user_id, session_id）
    """
    # P3-12.3.5: 尝试委托给 OtelSpanManager
    _manager: Any = None
    try:
        from observability.tracing import get_span_manager

        _manager = get_span_manager()
    except Exception as _import_err:  # noqa: BLE001
        logger.debug("OTel span manager unavailable, using fallback: %s", _import_err)

    if _manager is not None:
        # 委托给 OtelSpanManager（tracing enabled 时创建 OTel span，
        # 否则内部退化为日志记录——与原 P2-9 行为一致）
        with _manager.span(name, trace_id=trace_id, **attributes):
            yield
        return

    # 降级路径：原始日志记录行为（observability 模块不可用时）
    start = time.perf_counter()
    attrs = {"trace_id": trace_id, **attributes}
    logger.debug("span.start: %s attrs=%s", name, attrs)
    try:
        yield
    except Exception as e:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.error(
            "span.error: %s elapsed=%.2fms error=%s attrs=%s",
            name, elapsed_ms, str(e), attrs,
        )
        raise
    else:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "span.end: %s elapsed=%.2fms attrs=%s",
            name, elapsed_ms, attrs,
        )


def _validate_input_data(input_data: Dict[str, Any]) -> None:
    """P1-6: 入口层输入校验。

    使用 PerceptionInputSchema 验证 input_data 的关键字段，
    在进入 LangGraph 图之前拒绝非法输入。

    Args:
        input_data: 输入数据字典

    Raises:
        ValueError: 输入数据不合法
    """
    input_type = input_data.get("input_type", "text")
    prompt = input_data.get("prompt", "")

    # 使用 PerceptionInputSchema 校验 input_type 和 sensitivity_level
    raw_content = prompt.encode("utf-8") if isinstance(prompt, str) else b""
    sensitivity_level = input_data.get("sensitivity_level", 0)

    try:
        PerceptionInputSchema(
            input_type=input_type,
            raw_content=raw_content,
            sensitivity_level=sensitivity_level,
        )
    except ValueError as e:
        logger.warning("Input validation failed: %s", str(e))
        raise ValueError(f"Invalid input data: {e}") from e

    # 文本输入必须有 prompt
    if input_type == "text" and not prompt:
        raise ValueError("prompt is required for text input")


def _load_prev_config_overrides(
    graph: CompiledStateGraph,
    session_id: str,
) -> Dict[str, Any]:
    """P0-2: 从 checkpointer 读取上一次会话状态的 config_overrides。

    Args:
        graph: 编译后的 LangGraph 实例
        session_id: 会话标识

    Returns:
        config_overrides 字典（空字典表示无覆盖）
    """
    config_overrides: Dict[str, Any] = {}

    try:
        checkpointer = getattr(graph, "checkpointer", None)
        if checkpointer is not None and hasattr(checkpointer, "get_tuple"):
            config = {"configurable": {"thread_id": session_id}}
            state_tuple = checkpointer.get_tuple(config)
            if state_tuple is not None:
                state_values = state_tuple.values if hasattr(state_tuple, "values") else None
                if state_values and isinstance(state_values, dict):
                    prev_overrides = state_values.get("config_overrides", {})
                    if prev_overrides and isinstance(prev_overrides, dict):
                        config_overrides = dict(prev_overrides)
                        logger.info(
                            "Loaded config overrides from previous state for session %s: %s",
                            session_id, list(prev_overrides.keys()),
                        )
    except Exception as e:
        logger.debug("Failed to load config overrides from checkpointer: %s", str(e))

    return config_overrides


def _build_config_with_overrides(
    session_id: str,
    config_overrides: Dict[str, Any],
) -> Dict[str, Any]:
    """P0-2: 构建带 config_overrides 的 LangGraph 配置。

    将 config_overrides 合并到 configurable 中。

    Args:
        session_id: 会话标识
        config_overrides: 配置覆盖字典

    Returns:
        包含 configurable 字段的配置字典
    """
    configurable: Dict[str, Any] = {"thread_id": session_id}
    if config_overrides:
        configurable.update(config_overrides)
    return {"configurable": configurable}


async def stream_response(
    graph: CompiledStateGraph,
    user_id: str,
    session_id: str,
    input_data: Dict[str, Any],
    trace_id: Optional[str] = None,
    event_bridge: Optional[LangGraphEventBridge] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """替代 Coordinator.stream_request()。

    使用 LangGraph 原生 astream 实现流式输出，
    通过 EventBridge 桥接到现有 EventBus。

    Args:
        graph: 编译后的 LangGraph 实例
        user_id: 用户标识
        session_id: 会话标识（LangGraph thread_id）
        input_data: 输入数据（input_type / prompt / required_fields 等）
        trace_id: 链路追踪 ID（None=自动生成）
        event_bridge: 事件桥接器（None=自动创建）

    Yields:
        LangGraph stream 事件字典，格式取决于 stream_mode：
            - {"type": "messages", "data": {...}}: token 级流式
            - {"type": "updates", "node": "...", "data": {...}}: 节点更新
            - {"type": "values", "data": {...}}: 完整状态快照
    """
    # P1-6: 入口层输入校验
    _validate_input_data(input_data)

    if not trace_id:
        trace_id = str(uuid.uuid4())

    # P0-2: 从 checkpointer 读取上一次会话的 config_overrides
    config_overrides = _load_prev_config_overrides(graph, session_id)

    initial_state = make_initial_state(
        user_id=user_id,
        session_id=session_id,
        trace_id=trace_id,
        input_data=input_data,
    )
    # P0-2: 将 config_overrides 注入 initial_state，供 agent_node 读取
    if config_overrides:
        initial_state["config_overrides"] = config_overrides

    lg_config = _build_config_with_overrides(session_id, config_overrides)

    if event_bridge is None:
        # P0-1: 从图上读取 orchestrator 的 evolution_collector，激活 EventBridge 的信号收集
        evolution_collector = getattr(graph, "orchestrator", None)
        evolution_collector = evolution_collector.evolution_collector if evolution_collector else None
        event_bridge = LangGraphEventBridge(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            evolution_collector=evolution_collector,
        )

    raw_stream = graph.astream(
        initial_state,
        config=lg_config,
        stream_mode=["messages", "updates", "values"],
    )

    # P2-9: span 埋点——流式响应的总耗时（生成器生命周期由调用者控制，用 try/finally 确保结束记录）
    _stream_start = time.perf_counter()
    try:
        async for event in event_bridge.consume(raw_stream):
            yield event
    finally:
        _elapsed_ms = (time.perf_counter() - _stream_start) * 1000
        logger.info(
            "span.end: stream_response elapsed=%.2fms trace_id=%s user_id=%s session_id=%s",
            _elapsed_ms, trace_id, user_id, session_id,
        )
        # P3-12.3.5: 记录流式请求指标
        try:
            from observability.metrics import get_metrics_registry

            get_metrics_registry().record_request(
                status="success",
                duration=(_elapsed_ms / 1000.0),
            )
        except Exception:  # noqa: BLE001
            pass


async def run_sync(
    graph: CompiledStateGraph,
    user_id: str,
    session_id: str,
    input_data: Dict[str, Any],
    trace_id: Optional[str] = None,
    event_bridge: Optional[LangGraphEventBridge] = None,
) -> Dict[str, Any]:
    """替代 Coordinator.process_request()。

    非流式调用，等待完整结果。

    Args:
        graph: 编译后的 LangGraph 实例
        user_id: 用户标识
        session_id: 会话标识（LangGraph thread_id）
        input_data: 输入数据
        trace_id: 链路追踪 ID（None=自动生成）
        event_bridge: 事件桥接器（None=自动创建）

    Returns:
        响应字典，格式与 Coordinator.process_request() 一致：
            {
                "status": "success" | "error",
                "error_code": str,
                "data": {
                    "response": str,
                    "tool_results": List[Dict],
                    "trace_id": str,
                }
            }
    """
    # P1-6: 入口层输入校验
    try:
        _validate_input_data(input_data)
    except ValueError as e:
        return {
            "status": "error",
            "error_code": ErrorCode.PERCEPTION_INPUT_INVALID,
            "data": {"message": str(e), "trace_id": trace_id or str(uuid.uuid4())},
        }

    if not trace_id:
        trace_id = str(uuid.uuid4())

    # P3-12.3.5: metrics 计时起点
    _metrics_start = time.perf_counter()

    def _record_metrics(status: str) -> None:
        """P3-12.3.5: 记录请求指标（metrics 未启用时为 no-op）。"""
        try:
            from observability.metrics import get_metrics_registry

            get_metrics_registry().record_request(
                status=status,
                duration=time.perf_counter() - _metrics_start,
            )
        except Exception:  # noqa: BLE001
            pass

    # P0-2: 从 checkpointer 读取上一次会话的 config_overrides
    config_overrides = _load_prev_config_overrides(graph, session_id)

    initial_state = make_initial_state(
        user_id=user_id,
        session_id=session_id,
        trace_id=trace_id,
        input_data=input_data,
    )
    # P0-2: 将 config_overrides 注入 initial_state，供 agent_node 读取
    if config_overrides:
        initial_state["config_overrides"] = config_overrides

    lg_config = _build_config_with_overrides(session_id, config_overrides)

    if event_bridge is None:
        # P0-1: 从图上读取 orchestrator 的 evolution_collector
        evolution_collector = getattr(graph, "orchestrator", None)
        evolution_collector = evolution_collector.evolution_collector if evolution_collector else None
        event_bridge = LangGraphEventBridge(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            evolution_collector=evolution_collector,
        )

    try:
        # P2-9: span 埋点——run_sync 总耗时
        with _span("run_sync", trace_id=trace_id, user_id=user_id, session_id=session_id):
            final_state: Optional[Dict[str, Any]] = None
            async for event in event_bridge.consume(
                graph.astream(
                    initial_state,
                    config=lg_config,
                    stream_mode=["updates", "values"],
                )
            ):
                if event.get("type") == "values":
                    final_state = event.get("data", {})

            # P1-4: astream 失败时不应回退到 ainvoke，应直接报错
            # 避免请求被执行两次（一次 astream 一次 ainvoke）
            if final_state is None:
                logger.error("LangGraph astream produced no values event, trace_id=%s", trace_id)
                return {
                    "status": "error",
                    "error_code": ErrorCode.LLM_GENERATION_FAILED,
                    "data": {"message": "No output produced", "trace_id": trace_id},
                }

        error_code = final_state.get("error_code", "")
        if error_code:
            _record_metrics("error")
            return {
                "status": "error",
                "error_code": error_code,
                "data": {
                    "message": final_state.get("error_message", ""),
                    "trace_id": trace_id,
                },
            }

        config = get_config()
        sensitivity_threshold = config.get("perception.sensitivity_threshold", 5)
        sensitivity_level = final_state.get("sensitivity_level", 0)
        if sensitivity_level >= sensitivity_threshold:
            _record_metrics("circuit_breaker")
            return {
                "status": "error",
                "error_code": ErrorCode.PERCEPTION_SENSITIVITY_REJECTED,
                "data": {"message": "Input rejected due to sensitive content"},
            }

        _record_metrics("success")
        return {
            "status": "success",
            "error_code": "",
            "data": {
                "response": final_state.get("response", ""),
                "tool_results": final_state.get("tool_results", []),
                "trace_id": trace_id,
            },
        }

    except Exception as e:
        logger.error("LangGraph run_sync failed: %s", str(e))
        _record_metrics("error")
        return {
            "status": "error",
            "error_code": ErrorCode.LLM_GENERATION_FAILED,
            "data": {"message": str(e), "trace_id": trace_id},
        }


def get_runner(engine: Optional[str] = None) -> Any:
    """获取 LangGraph CompiledStateGraph 实例。

    P0-2: LangGraph 成为唯一引擎，移除 legacy Coordinator 分支。
    engine 参数保留用于向后兼容，但仅支持 "langgraph"（其他值将记录警告）。

    P1-12.2.6: 缓存编译图实例，配合配置 hash 检测；配置变更时自动重建。
    避免每次请求都重新构建图（含 LLM/工具/checkpointer/store 初始化）的开销。

    P2-12.2.4: 注册配置变更回调，llm.*/tools.* 等关键配置变更时主动触发缓存失效，
    无需等待下次 get_runner() 的 hash 检测——实现"主动传导"而非"惰性重建"。

    Args:
        engine: 引擎类型（保留向后兼容，默认从配置读取）

    Returns:
        ModuGraph 包装器（透明委托 CompiledStateGraph 的所有方法）
    """
    # P2-12.2.4: 首次调用时注册配置变更回调（仅注册一次）
    _ensure_config_callback_registered()

    config = get_config()
    engine = engine or config.get("orchestration.engine", "langgraph")

    if engine != "langgraph":
        logger.warning(
            "Engine '%s' is no longer supported, falling back to langgraph", engine
        )

    global _runner_cache, _runner_config_hash

    current_hash = _hash_config(config)
    # 双重检查：锁外快速路径（命中且 hash 一致），锁内兜底防止并发重建
    if _runner_cache is not None and current_hash == _runner_config_hash:
        return _runner_cache

    with _runner_cache_lock:
        # 持锁后再次检查，避免多个线程同时进入并重复构建
        if _runner_cache is not None and current_hash == _runner_config_hash:
            return _runner_cache

        from modu_graph.factory import create_agent
        logger.info(
            "Rebuilding LangGraph runner (config_hash changed: %s -> %s)",
            _runner_config_hash, current_hash,
        )
        _runner_cache = create_agent()
        _runner_config_hash = current_hash
        return _runner_cache


def _ensure_config_callback_registered() -> None:
    """P2-12.2.4: 确保配置变更回调已注册（线程安全，仅注册一次）。

    注册一个回调到 RuntimeConfig，当 llm.*/tools.*/memory.* 等影响图结构的
    配置变更时，主动调用 reset_runner_cache() 使缓存失效。
    下次 get_runner() 调用时将重建图——实现配置热更新的主动传导。

    与 P1-12.2.6 的 hash 惰性重建互补：
    - hash 惰性重建：兜底机制，确保最终一致性
    - 回调主动传导：即时响应，避免缓存窗口期内的旧图请求
    """
    global _config_callback_registered
    if _config_callback_registered:
        return
    with _config_callback_lock:
        if _config_callback_registered:
            return
        try:
            config = get_config()
            config.register_change_callback(_on_config_change)
            _config_callback_registered = True
            logger.info("Config change callback registered for runner cache invalidation")
        except Exception as e:
            logger.warning("Failed to register config change callback: %s", str(e))


def _on_config_change(key_path: str, old_value: Any, new_value: Any) -> None:
    """P2-12.2.4: 配置变更回调——影响图结构的配置变更时主动失效缓存。

    Args:
        key_path: 变更的配置路径（如 "llm.temperature"）
        old_value: 旧值
        new_value: 新值
    """
    for prefix in _GRAPH_REBUILD_PREFIXES:
        if key_path.startswith(prefix):
            logger.info(
                "Config change detected ('%s'), invalidating runner cache for proactive rebuild",
                key_path,
            )
            reset_runner_cache()
            return


def reset_runner_cache() -> None:
    """重置 runner 缓存（测试隔离用）。

    P1-12.2.6: 测试在修改配置后应调用此函数，确保下次 get_runner() 重建图。
    """
    global _runner_cache, _runner_config_hash
    with _runner_cache_lock:
        _runner_cache = None
        _runner_config_hash = None


async def process_request_compat(
    runner: Any,
    user_id: str,
    session_id: str,
    input_data: Dict[str, Any],
    trace_id: Optional[str] = None,
) -> Dict[str, Any]:
    """统一调用接口（P0-2: 仅支持 LangGraph CompiledStateGraph）。

    Args:
        runner: CompiledStateGraph 实例
        user_id: 用户标识
        session_id: 会话标识
        input_data: 输入数据
        trace_id: 链路追踪 ID

    Returns:
        统一格式的响应字典
    """
    if hasattr(runner, "ainvoke"):
        return await run_sync(
            graph=runner,
            user_id=user_id,
            session_id=session_id,
            input_data=input_data,
            trace_id=trace_id,
        )
    raise TypeError(f"Unsupported runner type: {type(runner)}")


async def stream_request_compat(
    runner: Any,
    user_id: str,
    session_id: str,
    input_data: Dict[str, Any],
    trace_id: Optional[str] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """统一流式调用接口（P0-2: 仅支持 LangGraph CompiledStateGraph）。

    Args:
        runner: CompiledStateGraph 实例
        user_id: 用户标识
        session_id: 会话标识
        input_data: 输入数据
        trace_id: 链路追踪 ID

    Yields:
        LangGraph stream 事件字典
    """
    if hasattr(runner, "astream"):
        async for event in stream_response(
            graph=runner,
            user_id=user_id,
            session_id=session_id,
            input_data=input_data,
            trace_id=trace_id,
        ):
            yield event
    else:
        raise TypeError(f"Unsupported runner type: {type(runner)}")


# ============================================================
# P3-12.3.2 Human-in-the-loop resume 入口
# ============================================================

async def resume_sync(
    graph: CompiledStateGraph,
    session_id: str,
    approved: bool,
    feedback: str = "",
    trace_id: Optional[str] = None,
) -> Dict[str, Any]:
    """P3-12.3.2: 恢复被 interrupt 暂停的图执行。

    当 ``human_review_node`` 调用 ``interrupt(...)`` 暂停图后，
    调用者通过此方法提供审批结果并恢复执行。

    Args:
        graph: 已暂停的 CompiledStateGraph 实例
        session_id: 会话标识（必须与原请求一致，用于从 checkpoint 恢复）
        approved: 审批结果（True=通过，False=拒绝）
        feedback: 审批反馈备注（可选）
        trace_id: 链路追踪 ID（可选，用于日志关联）

    Returns:
        恢复执行后的最终状态字典，结构同 ``run_sync``：
            {
                "status": "success" | "error",
                "error_code": str,
                "data": {"response": str, "tool_results": List, "trace_id": str},
            }
    """
    if not trace_id:
        trace_id = str(uuid.uuid4())

    try:
        from langgraph.types import Command
    except ImportError as e:
        logger.error("langgraph.types.Command unavailable: %s", str(e))
        return {
            "status": "error",
            "error_code": ErrorCode.LLM_GENERATION_FAILED,
            "data": {"message": f"Command API unavailable: {e}", "trace_id": trace_id},
        }

    lg_config = {"configurable": {"thread_id": session_id}}
    resume_payload = {"approved": bool(approved), "feedback": str(feedback or "")}

    try:
        with _span(
            "resume_sync",
            trace_id=trace_id,
            session_id=session_id,
            approved=approved,
        ):
            final_state: Optional[Dict[str, Any]] = None
            async for event in graph.astream(
                Command(resume=resume_payload),
                config=lg_config,
                stream_mode=["updates", "values"],
            ):
                # LangGraph 1.2.7 astream 产出 (mode, chunk) 元组
                if isinstance(event, tuple) and len(event) == 2:
                    mode, chunk = event
                    if mode == "values" and isinstance(chunk, dict):
                        final_state = chunk
                elif isinstance(event, dict):
                    if event.get("type") == "values":
                        final_state = event.get("data", {})

            if final_state is None:
                logger.error(
                    "Resume produced no values event, trace_id=%s session_id=%s",
                    trace_id, session_id,
                )
                return {
                    "status": "error",
                    "error_code": ErrorCode.LLM_GENERATION_FAILED,
                    "data": {"message": "Resume produced no output", "trace_id": trace_id},
                }

        error_code = final_state.get("error_code", "")
        if error_code:
            return {
                "status": "error",
                "error_code": error_code,
                "data": {
                    "message": final_state.get("error_message", ""),
                    "trace_id": trace_id,
                },
            }

        return {
            "status": "success",
            "error_code": "",
            "data": {
                "response": final_state.get("response", ""),
                "tool_results": final_state.get("tool_results", []),
                "trace_id": trace_id,
                "approval_status": final_state.get("approval_status", ""),
            },
        }

    except Exception as e:
        logger.error(
            "Resume failed: %s (trace_id=%s session_id=%s)",
            str(e), trace_id, session_id,
        )
        return {
            "status": "error",
            "error_code": ErrorCode.LLM_GENERATION_FAILED,
            "data": {"message": str(e), "trace_id": trace_id},
        }


async def resume_stream(
    graph: CompiledStateGraph,
    session_id: str,
    approved: bool,
    feedback: str = "",
    trace_id: Optional[str] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """P3-12.3.2: 恢复被 interrupt 暂停的图执行（流式版本）。

    与 ``resume_sync`` 类似，但通过 astream 流式产出事件。

    Args:
        graph: 已暂停的 CompiledStateGraph 实例
        session_id: 会话标识
        approved: 审批结果
        feedback: 审批反馈备注
        trace_id: 链路追踪 ID

    Yields:
        LangGraph stream 事件字典
    """
    if not trace_id:
        trace_id = str(uuid.uuid4())

    try:
        from langgraph.types import Command
    except ImportError as e:
        logger.error("langgraph.types.Command unavailable: %s", str(e))
        yield {
            "type": "error",
            "data": {"message": f"Command API unavailable: {e}", "trace_id": trace_id},
        }
        return

    lg_config = {"configurable": {"thread_id": session_id}}
    resume_payload = {"approved": bool(approved), "feedback": str(feedback or "")}

    _stream_start = time.perf_counter()
    try:
        async for event in graph.astream(
            Command(resume=resume_payload),
            config=lg_config,
            stream_mode=["messages", "updates", "values"],
        ):
            # LangGraph 1.2.7 astream 产出 (mode, chunk) 元组
            if isinstance(event, tuple) and len(event) == 2:
                mode, chunk = event
                yield {"type": mode, "data": chunk}
            elif isinstance(event, dict):
                yield event
    finally:
        _elapsed_ms = (time.perf_counter() - _stream_start) * 1000
        logger.info(
            "span.end: resume_stream elapsed=%.2fms trace_id=%s session_id=%s approved=%s",
            _elapsed_ms, trace_id, session_id, approved,
        )


def get_interrupt_state(
    graph: CompiledStateGraph,
    session_id: str,
) -> Optional[Dict[str, Any]]:
    """P3-12.3.2: 查询指定 session 当前是否处于 interrupt 暂停状态。

    用于调用者在决定是否调用 resume_sync 之前检查图状态。

    Args:
        graph: CompiledStateGraph 实例
        session_id: 会话标识

    Returns:
        - None: 未暂停或无 checkpoint
        - dict: 暂停时的 interrupt payload（含 tool_calls / message 等）
    """
    try:
        lg_config = {"configurable": {"thread_id": session_id}}
        state = graph.get_state(lg_config)
        if state is None:
            return None
        # 检查是否在 interrupt 暂停状态
        # LangGraph 1.2.7: state.next 包含下一个待执行节点；interrupts 包含暂停信息
        next_nodes = getattr(state, "next", None) or []
        if not next_nodes:
            return None
        # 检查是否为 human_review 节点的暂停
        if "human_review" not in next_nodes:
            return None
        # 从 state.values 提取 interrupt 上下文
        values = getattr(state, "values", None) or {}
        return {
            "session_id": session_id,
            "next_nodes": list(next_nodes),
            "pending_tool_calls": values.get("pending_tool_calls", []),
            "tool_requires_approval": values.get("tool_requires_approval", False),
            "trace_id": values.get("trace_id", ""),
            "user_id": values.get("user_id", ""),
        }
    except Exception as e:
        logger.debug("Failed to query interrupt state: %s", str(e))
        return None
