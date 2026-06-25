"""ModuAgent LangGraph 图节点定义。

将 orchestration/coordinator.py 的 Coordinator 主流程拆解为独立节点函数，
用 LangGraph 编排替代 1047 行的"上帝类"。

节点列表：
    - perception_node: 对应 _run_perception_pipeline + 敏感度熔断
    - memory_query_node: 对应 _storage_adapter.query_all
    - agent_node: 对应 _llm_adapter.generate + bind_tools（原生 function calling）
    - tools_node: 对应 _tool_adapter.invoke_tool（由 LangGraph ToolNode 接管）
    - memory_update_node: 记忆更新节点（新增）

路由函数：
    - route_after_perception: 敏感度熔断 + 注入检测熔断
    - route_after_agent: ReAct 循环退出判断（检查 tool_calls）
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from components.perception import (
    build_perception_event_metadata,
    extract_perception_context,
)
from components.perception.fusion import PerceptionFusion
from config.runtime_config import get_config
from core.registry import get_registry
from langgraph.state import ModuAgentState
from orchestration.communication.message_bus import get_event_bus
from orchestration.communication.protocol import (
    AgentEvent,
    EventAction,
    EventDomain,
    ErrorCode,
)

logger = logging.getLogger(__name__)


# ============================================================
# 感知节点（对应 Coordinator._run_perception_pipeline + 熔断）
# ============================================================

def perception_node(state: ModuAgentState) -> dict:
    """感知层节点：输入路由 + 感知器链 + 多路融合。

    复用现有 PerceptionFusion + TextPreprocessor 的业务逻辑，
    对应 coordinator.py 中 _run_perception_pipeline() 方法。

    流程：
        1. 根据 input_type 从 routing 配置获取感知器链
        2. 依次执行每个感知器，前一个的输出文本作为后一个的输入
        3. 若有多个感知器结果，使用 PerceptionFusion 融合
        4. 提取 cleaned_text / sensitivity_level / confidence

    Args:
        state: 当前图状态

    Returns:
        状态更新字典（perception_result / cleaned_text / sensitivity_level /
        confidence / detected_language / injection_detected）
    """
    config = get_config()
    registry = get_registry()
    input_data = state.get("input_data", {})

    input_type = input_data.get("input_type", "text")
    prompt = input_data.get("prompt", "")
    raw_content = prompt.encode("utf-8")
    sensitivity_level = input_data.get("sensitivity_level", 0)

    # 获取路由配置
    routing = config.get("perception.routing", {})
    pipeline_config = routing.get(input_type, {})
    pipeline: List[str] = pipeline_config.get("pipeline", ["text_preprocessor"])

    if not pipeline:
        pipeline = ["text_preprocessor"]

    results: List[Dict[str, Any]] = []
    current_content = raw_content
    current_input_type = input_type

    for processor_name in pipeline:
        perception = registry.get_perception(processor_name)
        if perception is None:
            logger.warning("Perception component '%s' not registered, skipping", processor_name)
            continue

        try:
            result = perception.perceive(
                input_type=current_input_type,
                raw_content=current_content,
                sensitivity_level=sensitivity_level,
            )
            results.append(result)

            # 管线传递：若感知器输出转为文本，则后续感知器以文本为输入
            parsed = result.get("parsed_content", {})
            if parsed.get("text") and parsed.get("input_type") == "text":
                current_content = parsed["text"].encode("utf-8")
                current_input_type = "text"

        except Exception as e:
            logger.error("Perception '%s' failed: %s", processor_name, str(e))
            continue

    if not results:
        return {
            "perception_result": None,
            "cleaned_text": prompt,
            "sensitivity_level": 0,
            "confidence": 1.0,
            "detected_language": None,
            "injection_detected": False,
        }

    # 单路结果直接返回，多路融合
    if len(results) == 1:
        fused = results[0]
    else:
        fusion = PerceptionFusion(
            strategy=config.get("perception.fusion.strategy", "weighted_average"),
            weights=config.get("perception.fusion.weights"),
        )
        fused = fusion.fuse(results)

    cleaned_text = None
    if fused and fused.get("parsed_content"):
        cleaned_text = fused["parsed_content"].get("text")

    meta = fused.get("metadata", {})
    detected_level = meta.get("sensitivity_level", 0)
    confidence = fused.get("confidence", 1.0)
    injection_detected = meta.get("injection_detected", False)
    detected_language = fused.get("detected_language")

    return {
        "perception_result": fused,
        "cleaned_text": cleaned_text or prompt,
        "sensitivity_level": detected_level,
        "confidence": confidence,
        "detected_language": detected_language,
        "injection_detected": injection_detected,
    }


# ============================================================
# 记忆查询节点（对应 Coordinator._storage_adapter.query_all）
# ============================================================

def memory_query_node(state: ModuAgentState) -> dict:
    """记忆查询节点（无 Store 版本）：返回空知识列表。

    短期历史由 LangGraph Checkpointer 通过 thread_id 自动管理。
    长期知识查询需通过 make_memory_query_node(store) 创建带 Store 的版本。

    Returns:
        状态更新字典（knowledge=[]）
    """
    return {"knowledge": []}


def make_memory_query_node(store: Any) -> Callable[[ModuAgentState], dict]:
    """创建带 Store 的记忆查询节点。

    Args:
        store: LangGraph BaseStore 实例（None 时退化为无查询）

    Returns:
        记忆查询节点函数
    """

    def _memory_query_node(state: ModuAgentState) -> dict:
        """记忆查询节点：从 Store 检索长期知识。"""
        user_id = state.get("user_id", "")
        cleaned_text = state.get("cleaned_text", "")

        knowledge: List[Dict[str, Any]] = []

        if store and cleaned_text:
            try:
                items = store.search(
                    (user_id, "knowledge"),
                    query=cleaned_text,
                    limit=5,
                )
                for item in items:
                    knowledge.append(item.value)
            except Exception as e:
                logger.warning("Store search error: %s", str(e))

        return {"knowledge": knowledge}

    return _memory_query_node


# ============================================================
# 记忆更新节点（新增）
# ============================================================

def memory_update_node(state: ModuAgentState) -> dict:
    """记忆更新节点：将对话历史写入长期记忆。

    替代 coordinator.py 中 fire-and-forget 的记忆更新，
    确保更新可观测、异常可追踪。

    流程：
        1. 从 messages 提取对话历史
        2. 调用 Store.put() 写入长期记忆
        3. 返回更新结果

    Args:
        state: 当前图状态

    Returns:
        状态更新字典（memory_update_status）
    """
    from langgraph.state import ModuAgentState as StateType

    store = getattr(state, "_store", None) or state.get("__store__")
    if store is None:
        return {"memory_update_status": "skipped_no_store"}

    messages = state.get("messages", [])
    user_id = state.get("user_id", "")
    session_id = state.get("session_id", "")

    if not messages:
        return {"memory_update_status": "skipped_no_messages"}

    try:
        # 构建对话历史文本
        history_parts = []
        for msg in messages:
            if isinstance(msg, HumanMessage):
                role = "user"
                content = msg.content
            elif isinstance(msg, AIMessage):
                role = "assistant"
                content = msg.content
            elif hasattr(msg, "type") and msg.type == "tool":
                role = "tool"
                content = f"[{getattr(msg, 'name', 'unknown')}] {msg.content}"
            else:
                continue
            history_parts.append(f"{role}: {content}")

        if history_parts:
            history_text = "\n".join(history_parts)
            key = f"{session_id}_{int(time.time())}"

            store.put(
                namespace=(user_id, "history"),
                key=key,
                value={
                    "content": history_text,
                    "session_id": session_id,
                    "message_count": len(messages),
                    "timestamp": int(time.time()),
                },
            )
            return {"memory_update_status": "success", "memory_update_key": key}

    except Exception as e:
        logger.error("Memory update error: %s", str(e))
        return {"memory_update_status": "error", "memory_update_error": str(e)}

    return {"memory_update_status": "skipped"}


# ============================================================
# 路由函数
# ============================================================

def route_after_perception(state: ModuAgentState) -> str:
    """感知后路由：敏感度熔断 + 注入检测熔断。

    对应 coordinator.py 中 process_request 的熔断逻辑：
        - 敏感度 >= threshold → END（返回错误）
        - 注入检测 + block_on_injection → END（返回错误）
        - 否则 → memory_query

    Returns:
        "memory_query" 或 "__end__"
    """
    config = get_config()

    sensitivity_threshold = config.get("perception.sensitivity_threshold", 5)
    if state.get("sensitivity_level", 0) >= sensitivity_threshold:
        logger.warning(
            "Sensitivity circuit breaker: level=%d >= threshold=%d",
            state.get("sensitivity_level", 0),
            sensitivity_threshold,
        )
        return "__end__"

    security_config = config.get("perception.security", {})
    if security_config.get("block_on_injection") and state.get("injection_detected", False):
        logger.warning("Injection detected, circuit breaker triggered")
        return "__end__"

    return "memory_query"


def route_after_agent(state: ModuAgentState) -> str:
    """推理后路由：ReAct 循环退出判断。

    检查最后一条消息是否包含 tool_calls：
        - 有 tool_calls → "tools"（进入 ReAct 循环）
        - 无 tool_calls → "__end__"（正常结束）

    LangGraph 的 recursion_limit 替代 max_iterations。

    Returns:
        "tools" 或 "__end__"
    """
    messages = state.get("messages", [])
    if not messages:
        return "__end__"

    last_msg = messages[-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "tools"
    return "__end__"


# ============================================================
# Agent 节点工厂（对应 _llm_adapter.generate + bind_tools）
# ============================================================

def make_agent_node(
    bound_llm: Any,
    system_prompt: Optional[str] = None,
    confidence_threshold: float = 0.5,
    conservative_temperature: float = 0.3,
) -> Callable[[ModuAgentState], dict]:
    """创建 agent 节点函数。

    使用绑定了工具的 LLM（bound_llm）进行推理，
    通过 LangChain 原生 bind_tools 实现原生 function calling，
    替代手写正则解析 ```tool_call``` 。

    新增功能：
    - 当感知置信度 < confidence_threshold 时，
      使用保守温度 conservative_temperature

    Args:
        bound_llm: 已通过 llm.bind_tools(tools) 绑定工具的 ChatModel
        system_prompt: 系统提示词（可选）
        confidence_threshold: 置信度阈值，低于此值使用保守温度
        conservative_temperature: 保守模式温度

    Returns:
        agent 节点函数
    """
    # 获取原始 LLM 用于动态调整温度
    _original_llm = getattr(bound_llm, "_llm", None) or bound_llm
    _default_temperature = getattr(_original_llm, "temperature", 0.7)

    def agent_node(state: ModuAgentState) -> dict:
        """推理节点：调用绑定了工具的 LLM 生成响应。

        对应 coordinator.py 中 _llm_adapter.generate() 调用。
        messages 由 State 自动维护，无需手动构建 prompt template。
        """
        messages: List[BaseMessage] = list(state.get("messages", []))

        # 如果没有消息，使用 cleaned_text 作为 HumanMessage
        if not messages:
            cleaned_text = state.get("cleaned_text") or state.get("input_data", {}).get("prompt", "")
            if cleaned_text:
                messages.append(HumanMessage(content=cleaned_text))

        # 注入系统提示词
        if system_prompt and (not messages or not isinstance(messages[0], SystemMessage)):
            messages.insert(0, SystemMessage(content=system_prompt))

        # 注入感知上下文（对应 coordinator.py 中 context["perception"] 注入）
        perception_result = state.get("perception_result")
        if perception_result:
            perception_ctx = extract_perception_context(perception_result)
            if perception_ctx:
                ctx_msg = SystemMessage(
                    content=f"Perception context: {json.dumps(perception_ctx, ensure_ascii=False, default=str)}",
                )
                insert_idx = 1 if system_prompt else 0
                messages.insert(insert_idx, ctx_msg)

        # 注入长期知识
        knowledge = state.get("knowledge", [])
        if knowledge:
            knowledge_text = "\n".join(
                item.get("content", "") for item in knowledge if isinstance(item, dict)
            )
            if knowledge_text:
                messages.insert(
                    1 if system_prompt else 0,
                    SystemMessage(content=f"Relevant knowledge from memory:\n{knowledge_text}"),
                )

        if not messages:
            return {"response": ""}

        # 低置信度保守模式：检测置信度并调整温度
        confidence = state.get("confidence", 1.0)
        effective_temperature = _default_temperature

        if confidence < confidence_threshold:
            effective_temperature = conservative_temperature
            logger.info(
                "Low confidence (%.2f < %.2f), using conservative temperature %.2f",
                confidence, confidence_threshold, conservative_temperature
            )
            # 克隆 LLM 并设置保守温度
            try:
                llm_with_temp = bound_llm.bind(temperature=effective_temperature)
                response = llm_with_temp.invoke(messages)
            except (AttributeError, TypeError):
                # 如果 bind 不支持 temperature，直接使用原 LLM
                response = bound_llm.invoke(messages)
        else:
            response = bound_llm.invoke(messages)

        return {"messages": [response]}

    return agent_node


# ============================================================
# 工具结果处理节点（对应 coordinator.py 工具结果观察拼接）
# ============================================================

def make_tool_result_processor() -> Callable[[ModuAgentState], dict]:
    """创建工具结果处理节点函数。

    在 ToolNode 执行后，将工具结果提取为 tool_results 列表，
    对应 coordinator.py 中 iteration_results 收集逻辑。

    LangGraph 的 ToolNode 已自动将工具结果作为 ToolMessage 追加到 messages，
    此节点仅用于提取 tool_results 供最终响应使用。
    """

    def tool_result_processor(state: ModuAgentState) -> dict:
        """处理工具执行结果，提取到 tool_results 字段。"""
        messages = state.get("messages", [])
        tool_results: List[Dict[str, Any]] = list(state.get("tool_results", []))

        for msg in messages:
            if hasattr(msg, "type") and msg.type == "tool":
                content = msg.content if hasattr(msg, "content") else ""
                tool_name = getattr(msg, "name", "") or "unknown"
                tool_call_id = getattr(msg, "tool_call_id", "")

                try:
                    parsed_content = json.loads(content) if isinstance(content, str) else content
                except (json.JSONDecodeError, TypeError):
                    parsed_content = {"raw": content}

                existing_ids = {r.get("execution_id") for r in tool_results}
                if tool_call_id not in existing_ids:
                    tool_results.append({
                        "tool": tool_name,
                        "execution_id": tool_call_id,
                        "result": parsed_content if isinstance(parsed_content, dict) else {"data": parsed_content},
                        "status": "success",
                    })

        return {"tool_results": tool_results}

    return tool_result_processor


# ============================================================
# 最终响应节点（增强：包含完整响应结构）
# ============================================================

def response_node(state: ModuAgentState) -> dict:
    """最终响应节点：提取最终响应文本。

    对应 coordinator.py 中 process_request 的返回结构构建。

    增强：返回完整响应结构（response + tool_results + usage + error_code）
    """
    messages = state.get("messages", [])
    response = ""
    usage = state.get("usage", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})
    tool_results = state.get("tool_results", [])

    for msg in reversed(messages):
        if isinstance(msg, AIMessage) and msg.content:
            response = msg.content
            # 尝试从 AIMessage 获取 usage 信息
            if hasattr(msg, "usage_metadata") and msg.usage_metadata:
                usage = {
                    "prompt_tokens": msg.usage_metadata.get("input_tokens", 0),
                    "completion_tokens": msg.usage_metadata.get("output_tokens", 0),
                    "total_tokens": msg.usage_metadata.get("total_tokens", 0),
                }
            break

    error_code = state.get("error_code", "")
    if error_code:
        return {
            "response": response,
            "error_code": error_code,
            "error_message": state.get("error_message", ""),
            "tool_results": tool_results,
            "usage": usage,
        }

    return {
        "response": response,
        "tool_results": tool_results,
        "usage": usage,
        "error_code": "",
        "error_message": "",
    }


# ============================================================
# 事件发布辅助函数（对应 coordinator.py 中事件发布）
# ============================================================

async def publish_perception_event(state: ModuAgentState) -> None:
    """发布感知事件到 EventBus。

    对应 coordinator.py 中 perception_event 的构建与发布。
    """
    event_bus = get_event_bus()
    trace_id = state.get("trace_id", "")
    session_id = state.get("session_id", "")
    user_id = state.get("user_id", "")
    perception_result = state.get("perception_result")
    input_data = state.get("input_data", {})
    input_type = input_data.get("input_type", "text")

    metadata = (
        build_perception_event_metadata(perception_result, input_type)
        if perception_result
        else {
            "input_type": input_type,
            "sensitivity_level": "0",
            "truncated": "False",
        }
    )

    event = AgentEvent(
        trace_id=trace_id,
        session_id=session_id,
        user_id=user_id,
        domain=EventDomain.PERCEPTION,
        action=EventAction.ANALYZE,
        metadata=metadata,
    )
    await event_bus.publish(event)


async def publish_memory_event(state: ModuAgentState) -> None:
    """发布记忆查询事件到 EventBus。"""
    event_bus = get_event_bus()
    trace_id = state.get("trace_id", "")
    session_id = state.get("session_id", "")
    user_id = state.get("user_id", "")
    knowledge = state.get("knowledge", [])

    event = AgentEvent(
        trace_id=trace_id,
        session_id=session_id,
        user_id=user_id,
        domain=EventDomain.MEMORY,
        action=EventAction.QUERY,
        metadata={"has_knowledge": str(len(knowledge) > 0)},
    )
    await event_bus.publish(event)


async def publish_action_event(state: ModuAgentState) -> None:
    """发布行动事件到 EventBus。"""
    event_bus = get_event_bus()
    trace_id = state.get("trace_id", "")
    session_id = state.get("session_id", "")
    user_id = state.get("user_id", "")
    tool_results = state.get("tool_results", [])

    event = AgentEvent(
        trace_id=trace_id,
        session_id=session_id,
        user_id=user_id,
        domain=EventDomain.ACTION,
        action=EventAction.EXECUTE,
        metadata={"tool_count": str(len(tool_results))},
    )
    await event_bus.publish(event)


async def publish_tool_events(
    state: ModuAgentState,
    tool_calls: List[Dict[str, Any]],
    tool_results: List[Dict[str, Any]],
) -> None:
    """发布工具调用与执行事件到 EventBus。

    对应 coordinator.py 中 tool_call_event 和 tool_result_event 的发布。
    """
    event_bus = get_event_bus()
    trace_id = state.get("trace_id", "")
    session_id = state.get("session_id", "")
    user_id = state.get("user_id", "")

    for tc in tool_calls:
        invoke_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.TOOL,
            action=EventAction.INVOKE,
            metadata={"tool_name": tc.get("name", "")},
        )
        await event_bus.publish(invoke_event)

    for tr in tool_results:
        execute_event = AgentEvent(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            domain=EventDomain.TOOL,
            action=EventAction.EXECUTE,
            metadata={
                "tool_name": tr.get("tool", ""),
                "tool_status": tr.get("status", "unknown"),
                "error_code": tr.get("error_code", ""),
            },
        )
        await event_bus.publish(execute_event)
