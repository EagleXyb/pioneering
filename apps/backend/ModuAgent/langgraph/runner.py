"""ModuAgent LangGraph 运行入口（流式/非流式）。

P0-2: LangGraph 成为唯一引擎，移除 legacy Coordinator 分支。

提供：
    - stream_response(): 流式调用，使用 LangGraph astream
    - run_sync(): 非流式调用
    - get_runner(): 获取 LangGraph CompiledGraph 实例
    - process_request_compat(): 统一调用接口（保留向后兼容）

LangGraph 提供 4 种 stream_mode：
    - messages: token 级流式
    - updates: 节点状态更新
    - values: 完整状态快照
    - custom: 自定义事件
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import contextmanager
from typing import Any, AsyncGenerator, Dict, Iterator, Optional

from langgraph.graph.graph import CompiledGraph

from config.runtime_config import get_config
from config.schemas import PerceptionInputSchema
from langgraph.adapters.event_bridge import LangGraphEventBridge
from langgraph.state import ModuAgentState, make_initial_state
from orchestration.communication.protocol import ErrorCode

logger = logging.getLogger(__name__)


@contextmanager
def _span(
    name: str,
    trace_id: str = "",
    **attributes: Any,
) -> Iterator[None]:
    """P2-9: 轻量级 span 埋点。

    记录 span 的开始/结束/耗时/异常到 logger。
    为后续接入 OpenTelemetry 提供基础——替换此函数即可升级为 OTel span。

    Args:
        name: span 名称（如 "run_sync", "stream_response"）
        trace_id: 链路追踪 ID
        **attributes: span 属性（如 user_id, session_id）
    """
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
    graph: CompiledGraph,
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
    graph: CompiledGraph,
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


async def run_sync(
    graph: CompiledGraph,
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
            return {
                "status": "error",
                "error_code": ErrorCode.PERCEPTION_SENSITIVITY_REJECTED,
                "data": {"message": "Input rejected due to sensitive content"},
            }

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
        return {
            "status": "error",
            "error_code": ErrorCode.LLM_GENERATION_FAILED,
            "data": {"message": str(e), "trace_id": trace_id},
        }


def get_runner(engine: Optional[str] = None) -> Any:
    """获取 LangGraph CompiledGraph 实例。

    P0-2: LangGraph 成为唯一引擎，移除 legacy Coordinator 分支。
    engine 参数保留用于向后兼容，但仅支持 "langgraph"（其他值将记录警告）。

    Args:
        engine: 引擎类型（保留向后兼容，默认从配置读取）

    Returns:
        CompiledGraph 实例（通过 create_agent() 创建）
    """
    config = get_config()
    engine = engine or config.get("orchestration.engine", "langgraph")

    if engine != "langgraph":
        logger.warning(
            "Engine '%s' is no longer supported, falling back to langgraph", engine
        )

    from langgraph.factory import create_agent
    return create_agent()


async def process_request_compat(
    runner: Any,
    user_id: str,
    session_id: str,
    input_data: Dict[str, Any],
    trace_id: Optional[str] = None,
) -> Dict[str, Any]:
    """统一调用接口（P0-2: 仅支持 LangGraph CompiledGraph）。

    Args:
        runner: CompiledGraph 实例
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
    """统一流式调用接口（P0-2: 仅支持 LangGraph CompiledGraph）。

    Args:
        runner: CompiledGraph 实例
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
