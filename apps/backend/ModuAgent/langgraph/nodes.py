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
from components.perception.pipeline import (
    run_perception_pipeline,
    run_perception_pipeline_async,
)
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

def _build_perception_result(
    fused: Optional[dict],
    prompt: str,
) -> dict:
    """从融合后的感知结果构建状态更新字典。

    供 perception_node（异步）和 perception_node_sync（同步回退）共用。
    """
    if not fused:
        return {
            "perception_result": None,
            "cleaned_text": prompt,
            "sensitivity_level": 0,
            "confidence": 1.0,
            "detected_language": None,
            "injection_detected": False,
            "pii_detected": False,
        }

    cleaned_text = None
    if fused.get("parsed_content"):
        cleaned_text = fused["parsed_content"].get("text")

    meta = fused.get("metadata", {})
    detected_level = meta.get("sensitivity_level", 0)
    confidence = fused.get("confidence", 1.0)
    injection_detected = meta.get("injection_detected", False)
    pii_detected = meta.get("pii_detected", False)
    detected_language = fused.get("detected_language")

    return {
        "perception_result": fused,
        "cleaned_text": cleaned_text or prompt,
        "sensitivity_level": detected_level,
        "confidence": confidence,
        "detected_language": detected_language,
        "injection_detected": injection_detected,
        "pii_detected": pii_detected,
    }


async def perception_node(state: ModuAgentState) -> dict:
    """感知层节点：输入路由 + 感知器链 + 多路融合。

    P1-5: 委托至公共感知管线函数，消除与 coordinator._run_perception_pipeline 的重复逻辑。
    P2-12.2.3: 改为异步节点，使用 run_perception_pipeline_async 并行执行独立感知器，
    显著提升多感知器场景下的感知延迟（如 text+image+audio 多模态输入）。

    Args:
        state: 当前图状态

    Returns:
        状态更新字典（perception_result / cleaned_text / sensitivity_level /
        confidence / detected_language / injection_detected / pii_detected）
    """
    config = get_config()
    registry = get_registry()
    input_data = state.get("input_data", {})
    prompt = input_data.get("prompt", "")

    fused = await run_perception_pipeline_async(input_data, config, registry)
    return _build_perception_result(fused, prompt)


def perception_node_sync(state: ModuAgentState) -> dict:
    """感知层节点同步版本（向后兼容 / 测试直接调用）。

    使用同步串行的 run_perception_pipeline，不享受并行加速。
    生产环境推荐使用异步 perception_node。
    """
    config = get_config()
    registry = get_registry()
    input_data = state.get("input_data", {})
    prompt = input_data.get("prompt", "")

    fused = run_perception_pipeline(input_data, config, registry)
    return _build_perception_result(fused, prompt)


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
    """记忆更新节点（无 Store 版本）：跳过更新。

    P0-3: 需通过 make_memory_update_node(store) 创建带 Store 的版本，
    并在 build_modu_graph() 中作为图节点接入。
    """
    return {"memory_update_status": "skipped_no_store"}


def make_memory_update_node(store: Any) -> Callable[[ModuAgentState], dict]:
    """创建带 Store 的记忆更新节点（P0-3）。

    替代 coordinator.py 中 fire-and-forget 的记忆更新，
    将记忆更新接入图结构，确保更新可观测、异常可追踪。

    Args:
        store: LangGraph BaseStore 实例（None 时退化为跳过）

    Returns:
        记忆更新节点函数
    """

    def _memory_update_node(state: ModuAgentState) -> dict:
        """记忆更新节点：将对话历史写入长期记忆。"""
        if store is None:
            return {"memory_update_status": "skipped_no_store"}

        # 熔断场景跳过记忆更新
        error_code = state.get("error_code", "")
        if error_code:
            return {"memory_update_status": "skipped_circuit_breaker"}

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

    return _memory_update_node


# ============================================================
# 路由函数
# ============================================================

def route_after_perception(state: ModuAgentState) -> str:
    """感知后路由：敏感度熔断 + 注入检测熔断 + PII 阻断（P2-6）。

    对应 coordinator.py 中 process_request 的熔断逻辑：
        - 敏感度 >= threshold → END（返回错误）
        - 注入检测 + block_on_injection → END（返回错误）
        - PII 检测 + block_on_pii → END（返回错误）
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

    # P2-6: PII 阻断接入熔断逻辑
    if security_config.get("block_on_pii") and state.get("pii_detected", False):
        logger.warning("PII detected, circuit breaker triggered")
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
    - P0-2: 从 state.config_overrides 读取 per-session 参数覆盖
      （temperature、max_reasoning_iterations 等）

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

        # P0-2: 从 state.config_overrides 读取 per-session 参数覆盖
        config_overrides = state.get("config_overrides", {})
        override_temperature = config_overrides.get("temperature")

        # 低置信度保守模式：检测置信度并调整温度
        confidence = state.get("confidence", 1.0)
        effective_temperature = _default_temperature

        # P0-2: config_overrides 中的 temperature 优先级高于默认值
        if override_temperature is not None:
            effective_temperature = float(override_temperature)

        need_custom_temp = False

        if confidence < confidence_threshold:
            effective_temperature = conservative_temperature
            need_custom_temp = True
            logger.info(
                "Low confidence (%.2f < %.2f), using conservative temperature %.2f",
                confidence, confidence_threshold, conservative_temperature
            )
        elif override_temperature is not None:
            need_custom_temp = True
            logger.debug(
                "Using config_overrides temperature: %.2f",
                override_temperature,
            )

        if need_custom_temp:
            # 克隆 LLM 并设置温度
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
# 反馈评估节点（P0-1: feedback/evolution 闭环）
# ============================================================

def make_feedback_node(orchestrator: Any) -> Callable[[ModuAgentState], dict]:
    """创建反馈评估节点（P0-1）。

    在 response 之后、memory_update 之前执行，评估响应质量并决定是否触发进化。

    P0-2 修复：将 session_id 传递给 orchestrator，
    并将 config_overrides 保存到 state 中，
    供下一次请求时注入 RunnableConfig.configurable。

    Args:
        orchestrator: EvolutionOrchestrator 实例

    Returns:
        反馈评估节点函数
    """

    async def _feedback_node(state: ModuAgentState) -> dict:
        """反馈评估节点：评估响应质量，触发进化判断。"""
        # 熔断场景跳过评估
        error_code = state.get("error_code", "")
        if error_code:
            return {
                "evaluation": None,
                "should_evolve": False,
                "evolution_action": None,
            }

        session_id = state.get("session_id", "")

        # 构建评估输入
        output = {
            "response": state.get("response", ""),
            "tool_results": state.get("tool_results", []),
            "usage": state.get("usage", {}),
        }

        context = {
            "prompt": state.get("input_data", {}).get("prompt", ""),
            "perception_result": state.get("perception_result"),
            "tool_results": state.get("tool_results", []),
            "iteration": state.get("iteration", 0),
        }

        try:
            result = await orchestrator.evaluate_and_evolve(
                output, context, session_id=session_id
            )
            evolution_action = result.get("evolution_action")

            # P0-2: 从 evolution_action 提取 config_overrides，保存到 state
            # 供下一次同会话请求时注入 RunnableConfig.configurable
            config_overrides: Dict[str, Any] = {}
            if evolution_action and evolution_action.get("adjusted"):
                config_overrides = evolution_action.get("config_overrides", {})
                if config_overrides:
                    logger.info(
                        "Config overrides saved for session %s: %s",
                        session_id, list(config_overrides.keys()),
                    )

            return {
                "evaluation": result.get("evaluation"),
                "should_evolve": result.get("should_evolve", False),
                "evolution_action": evolution_action,
                "config_overrides": config_overrides,
            }
        except Exception as e:
            logger.error("Feedback node failed: %s", str(e))
            return {
                "evaluation": None,
                "should_evolve": False,
                "evolution_action": None,
                "config_overrides": {},
            }

    return _feedback_node


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
