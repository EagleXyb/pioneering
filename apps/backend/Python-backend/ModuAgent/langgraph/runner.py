"""ModuAgent LangGraph 运行入口（流式/非流式）。

用 LangGraph 原生流式替代 Coordinator.stream_request() + SSEEncoder + EventBus 三件套。

提供：
    - stream_response(): 替代 Coordinator.stream_request()，使用 LangGraph astream
    - run_sync(): 替代 Coordinator.process_request()，非流式调用
    - get_runner(): 灰度切换入口（legacy / langgraph）
    - process_request_compat(): 统一调用接口（兼容 legacy 和 langgraph）

LangGraph 提供 4 种 stream_mode：
    - messages: token 级流式
    - updates: 节点状态更新
    - values: 完整状态快照
    - custom: 自定义事件
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, AsyncGenerator, Dict, Optional

from langgraph.graph.graph import CompiledGraph

from config.runtime_config import get_config
from langgraph.adapters.event_bridge import LangGraphEventBridge
from langgraph.state import ModuAgentState, make_initial_state
from orchestration.communication.protocol import ErrorCode

logger = logging.getLogger(__name__)


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
    if not trace_id:
        trace_id = str(uuid.uuid4())

    initial_state = make_initial_state(
        user_id=user_id,
        session_id=session_id,
        trace_id=trace_id,
        input_data=input_data,
    )

    lg_config: Dict[str, Any] = {
        "configurable": {"thread_id": session_id},
    }

    if event_bridge is None:
        event_bridge = LangGraphEventBridge(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
        )

    raw_stream = graph.astream(
        initial_state,
        config=lg_config,
        stream_mode=["messages", "updates", "values"],
    )

    async for event in event_bridge.consume(raw_stream):
        yield event


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
    if not trace_id:
        trace_id = str(uuid.uuid4())

    initial_state = make_initial_state(
        user_id=user_id,
        session_id=session_id,
        trace_id=trace_id,
        input_data=input_data,
    )

    lg_config: Dict[str, Any] = {
        "configurable": {"thread_id": session_id},
    }

    if event_bridge is None:
        event_bridge = LangGraphEventBridge(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
        )

    try:
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

        if final_state is None:
            final_state = await graph.ainvoke(initial_state, config=lg_config)

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
    """根据配置选择运行引擎（灰度切换入口）。

    对应重构方案阶段 6 的双轨运行：
        - legacy: 使用原 Coordinator
        - langgraph: 使用 LangGraph 重构版

    Args:
        engine: 引擎类型（None=从配置读取 orchestration.engine）

    Returns:
        legacy: Coordinator 实例
        langgraph: CompiledGraph 实例（通过 create_agent() 创建）
    """
    config = get_config()
    engine = engine or config.get("orchestration.engine", "legacy")

    if engine == "langgraph":
        from langgraph.factory import create_agent
        return create_agent()
    else:
        from orchestration.coordinator import Coordinator
        return Coordinator()


async def process_request_compat(
    runner: Any,
    user_id: str,
    session_id: str,
    input_data: Dict[str, Any],
    trace_id: Optional[str] = None,
) -> Dict[str, Any]:
    """统一调用接口（兼容 legacy Coordinator 和 langgraph）。

    根据 runner 类型自动选择调用方式：
        - Coordinator: 调用 process_request()
        - CompiledGraph: 调用 run_sync()

    Args:
        runner: Coordinator 或 CompiledGraph 实例
        user_id: 用户标识
        session_id: 会话标识
        input_data: 输入数据
        trace_id: 链路追踪 ID

    Returns:
        统一格式的响应字典
    """
    if hasattr(runner, "process_request"):
        return await runner.process_request(
            user_id=user_id,
            session_id=session_id,
            input_data=input_data,
            trace_id=trace_id,
        )
    elif hasattr(runner, "ainvoke"):
        return await run_sync(
            graph=runner,
            user_id=user_id,
            session_id=session_id,
            input_data=input_data,
            trace_id=trace_id,
        )
    else:
        raise TypeError(f"Unsupported runner type: {type(runner)}")


async def stream_request_compat(
    runner: Any,
    user_id: str,
    session_id: str,
    input_data: Dict[str, Any],
    trace_id: Optional[str] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """统一流式调用接口（兼容 legacy Coordinator 和 langgraph）。

    根据 runner 类型自动选择调用方式：
        - Coordinator: 调用 stream_request()
        - CompiledGraph: 调用 stream_response()

    Args:
        runner: Coordinator 或 CompiledGraph 实例
        user_id: 用户标识
        session_id: 会话标识
        input_data: 输入数据
        trace_id: 链路追踪 ID

    Yields:
        事件字典（legacy: SSE frame 格式；langgraph: LangGraph stream 事件格式）
    """
    if hasattr(runner, "stream_request"):
        async for event in runner.stream_request(
            user_id=user_id,
            session_id=session_id,
            input_data=input_data,
            trace_id=trace_id,
        ):
            yield event
    elif hasattr(runner, "astream"):
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
