"""ModuAgent LangGraph 图节点定义。

将 orchestration/coordinator.py 的 Coordinator 主流程拆解为独立节点函数，
用 LangGraph 编排替代 1047 行的"上帝类"。

节点列表：
    - perception_node: 对应 _run_perception_pipeline + 敏感度熔断
    - memory_query_node: 对应 _storage_adapter.query_all
    - agent_node: 对应 _llm_adapter.generate + bind_tools（原生 function calling）
    - tools_node: 对应 _tool_adapter.invoke_tool（由 LangGraph ToolNode 接管）
    - memory_update_node: 记忆更新节点（新增）
    - human_review_node (P3-12.3.2): 工具调用审批节点，敏感工具执行前 interrupt

路由函数：
    - route_after_perception: 敏感度熔断 + 注入检测熔断
    - route_after_agent: ReAct 循环退出判断（检查 tool_calls）
    - route_after_human_review (P3-12.3.2): 审批后路由（通过→tools，拒绝→response）
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage

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


# ============================================================
# P3-12.3.2 Human-in-the-loop 节点
# ============================================================

def _tool_requires_approval(
    tool_name: str,
    registry: Any,
    sensitive_tools: List[str],
) -> bool:
    """P3-12.3.2: 检测工具是否需要人工审批。

    判定逻辑（任一命中即视为需要审批）：
        1. 工具名在 sensitive_tools 配置列表中
        2. 工具实例的 requires_approval() 返回 True

    Args:
        tool_name: 工具名
        registry: ComponentRegistry 实例（可能为 None）
        sensitive_tools: 配置中的敏感工具名列表

    Returns:
        bool: True 表示需要审批
    """
    if tool_name in sensitive_tools:
        return True
    if registry is not None:
        modu_tool = registry.get_tool(tool_name)
        if modu_tool is not None:
            try:
                return bool(modu_tool.requires_approval())
            except Exception:
                # 工具方法异常时不阻断流程，按不需要审批处理
                return False
    return False


def make_human_review_node(
    registry: Any = None,
    config: Any = None,
) -> Callable[[ModuAgentState], dict]:
    """P3-12.3.2: 创建人工审批节点工厂。

    节点行为：
        1. 检查最近一条 AIMessage 的 tool_calls
        2. 若任一工具调用需要审批，调用 ``interrupt(...)`` 暂停图执行
        3. 调用者通过 ``Command(resume={"approved": bool, "feedback": str})`` 恢复
        4. 审批通过：返回 ``{"approval_status": "approved"}``，由后续节点（ToolNode）执行工具
        5. 审批拒绝：构造每个被拒工具的降级 ToolMessage，路由到 response 节点

    当 ``tools.human_in_loop.enabled=False`` 时，节点为 no-op，透传到 ToolNode。

    Args:
        registry: ComponentRegistry 实例（None=使用全局单例）
        config: RuntimeConfig 实例（None=使用全局单例）

    Returns:
        human_review 节点函数
    """

    async def _human_review_node(state: ModuAgentState) -> dict:
        """P3-12.3.2: 人工审批节点。"""
        # 读取 HITL 配置
        if config is not None:
            hitl_cfg = config.get("tools.human_in_loop", {})
        else:
            hitl_cfg = get_config().get("tools.human_in_loop", {})

        if not hitl_cfg.get("enabled", False):
            # HITL 关闭，直接透传
            return {"approval_status": "skipped"}

        sensitive_tools = hitl_cfg.get("sensitive_tools", [])

        # 获取最近一条 AIMessage
        messages = state.get("messages", [])
        if not messages:
            return {"approval_status": "no_tool_calls"}

        last_msg = messages[-1]
        tool_calls = getattr(last_msg, "tool_calls", None) or []
        if not tool_calls:
            return {"approval_status": "no_tool_calls"}

        # 识别需要审批的工具调用
        reg = registry if registry is not None else get_registry()
        pending = [
            tc for tc in tool_calls
            if _tool_requires_approval(tc.get("name", ""), reg, sensitive_tools)
        ]

        if not pending:
            # 无需审批，透传
            return {
                "approval_status": "not_required",
                "tool_requires_approval": False,
                "pending_tool_calls": [],
            }

        # 触发 interrupt 暂停图执行
        # interrupt(value) 返回由 Command(resume=...) 提供的恢复值
        try:
            from langgraph.types import interrupt
        except ImportError as e:
            logger.error("langgraph.types.interrupt unavailable: %s", str(e))
            return {
                "approval_status": "error",
                "error_code": "HITL_INTERRUPT_UNAVAILABLE",
                "error_message": str(e),
            }

        resume_payload = interrupt({
            "tool_calls": pending,
            "trace_id": state.get("trace_id", ""),
            "session_id": state.get("session_id", ""),
            "user_id": state.get("user_id", ""),
            "message": "Tool calls require human approval before execution",
        })

        # 解析 resume payload
        if isinstance(resume_payload, dict):
            approved = bool(resume_payload.get("approved", False))
            feedback = str(resume_payload.get("feedback", "") or "")
        else:
            approved = False
            feedback = ""

        if approved:
            return {
                "approval_status": "approved",
                "approval_feedback": feedback,
                "tool_requires_approval": False,
                "pending_tool_calls": [],
            }

        # 拒绝：为每个待审批工具调用生成降级 ToolMessage
        rejection_messages: List[ToolMessage] = []
        for tc in pending:
            tool_name = tc.get("name", "")
            args = tc.get("args", {}) or {}
            call_id = tc.get("id", "")

            modu_tool = reg.get_tool(tool_name) if reg else None
            if modu_tool is not None:
                try:
                    rejection_result = modu_tool.on_approval_rejected(args)
                except Exception as e:
                    rejection_result = {
                        "status": "error",
                        "error_code": "TOOL_APPROVAL_REJECTED",
                        "data": {"message": f"Tool {tool_name} rejected: {e}"},
                    }
            else:
                rejection_result = {
                    "status": "error",
                    "error_code": "TOOL_APPROVAL_REJECTED",
                    "data": {"message": f"Tool {tool_name} rejected by reviewer"},
                }

            rejection_messages.append(ToolMessage(
                content=json.dumps(rejection_result, ensure_ascii=False, default=str),
                tool_call_id=call_id,
                name=tool_name,
            ))

        return {
            "approval_status": "rejected",
            "approval_feedback": feedback,
            "tool_requires_approval": False,
            "pending_tool_calls": [],
            "messages": rejection_messages,
        }

    return _human_review_node


def route_after_human_review(state: ModuAgentState) -> str:
    """P3-12.3.2: 审批后路由。

    - "rejected" / "error" → "response"（跳过工具执行，进入响应阶段）
    - 其他（approved / not_required / no_tool_calls / skipped）→ "tools"（执行 ToolNode）

    Returns:
        "tools" 或 "response"
    """
    approval_status = state.get("approval_status", "")
    if approval_status in ("rejected", "error"):
        return "response"
    return "tools"


# ============================================================
# P3-12.3.1 多 Agent 协作节点
# ============================================================

def route_after_memory_query(state: ModuAgentState) -> str:
    """P3-12.3.1: memory_query 后路由——多 Agent 或单 Agent。

    - orchestration.multi_agent.enabled=True → "supervisor"
    - 否则 → "agent"（原行为）

    Returns:
        "supervisor" 或 "agent"
    """
    config = get_config()
    if config.get("orchestration.multi_agent.enabled", False):
        return "supervisor"
    return "agent"


def make_subagent_node(
    bound_llm: Any,
    system_prompt: Optional[str] = None,
) -> Callable[[ModuAgentState], dict]:
    """P3-12.3.1: 创建子 Agent 节点（处理单个子任务）。

    通过 Send API 并行调用，每次处理一个 ``current_subtask``。
    结果写入 ``subtask_results``（经 merge_subtask_results reducer 合并）。

    Args:
        bound_llm: 已绑定工具的 ChatModel
        system_prompt: 系统提示词（None=按 task_type 选择默认）

    Returns:
        子 Agent 节点函数
    """
    from langgraph.subgraph.builder import _get_system_prompt

    def _subagent_node(state: ModuAgentState) -> dict:
        """子 Agent 节点：处理 current_subtask 并返回结果。"""
        task = state.get("current_subtask", {})
        if not task:
            return {"subtask_results": {}}

        task_id = task.get("task_id", "")
        task_type = task.get("task_type", "default")
        task_input = task.get("task_input", {})
        prompt_text = task_input.get("prompt", "") or str(task_input)

        # 选择系统提示词
        effective_prompt = system_prompt or _get_system_prompt(task_type)

        messages: List[BaseMessage] = [
            SystemMessage(content=effective_prompt),
            HumanMessage(content=prompt_text),
        ]

        try:
            response = bound_llm.invoke(messages)
            content = getattr(response, "content", str(response))
            result = {
                "task_id": task_id,
                "task_type": task_type,
                "status": "success",
                "output": content,
            }
        except Exception as e:
            logger.error("Sub-agent LLM invoke failed (task_id=%s): %s", task_id, str(e))
            result = {
                "task_id": task_id,
                "task_type": task_type,
                "status": "error",
                "error": str(e),
                "output": "",
            }

        # 仅返回 subtask_results（不返回 current_subtask，避免并行写冲突）
        return {"subtask_results": {task_id: result}}

    return _subagent_node


def make_consensus_node(
    strategy: Any = None,
    judge_llm: Any = None,
    event_bus: Any = None,
) -> Callable[[ModuAgentState], dict]:
    """P3-12.3.1: 创建共识聚合节点。

    收集所有子 Agent 结果，通过共识策略聚合，生成最终响应。
    共识失败时发布 FEEDBACK 事件作为进化信号。

    Args:
        strategy: ConsensusStrategy 实例（None=从配置读取策略名并创建）
        judge_llm: LLM 裁决器（仅 llm_judge 策略需要）
        event_bus: EventBus 实例（None=使用全局单例）

    Returns:
        共识节点函数
    """

    async def _consensus_node(state: ModuAgentState) -> dict:
        """共识节点：聚合子任务结果，生成最终响应。"""
        from orchestration.patterns.consensus import create_consensus_strategy

        subtask_results = state.get("subtask_results", {})
        subtasks = state.get("subtasks", [])
        trace_id = state.get("trace_id", "")
        session_id = state.get("session_id", "")
        user_id = state.get("user_id", "")

        config = get_config()
        multi_agent_cfg = config.get("orchestration.multi_agent", {})
        quorum = multi_agent_cfg.get("consensus_quorum", 2)

        # 收集有效结果
        results = list(subtask_results.values())
        valid_results = [r for r in results if r.get("status") == "success"]

        # quorum 校验
        if len(valid_results) < quorum:
            logger.warning(
                "Consensus quorum not met: %d/%d (trace_id=%s)",
                len(valid_results), quorum, trace_id,
            )
            # 发布共识失败事件（进化信号）
            if multi_agent_cfg.get("consensus_failure_as_evolution_signal", True):
                try:
                    from orchestration.patterns.consensus import ConsensusPattern
                    pattern = ConsensusPattern(quorum=quorum, event_bus=event_bus)
                    await pattern._publish_consensus_failure(
                        {"trace_id": trace_id, "session_id": session_id, "user_id": user_id},
                        results,
                        reason=f"Quorum not met: {len(valid_results)}/{quorum}",
                    )
                except Exception as e:  # noqa: BLE001
                    logger.error("Failed to publish consensus failure: %s", str(e))

            # 降级：取最佳可用结果或空响应
            fallback_output = ""
            if valid_results:
                fallback_output = valid_results[0].get("output", "")
            elif results:
                fallback_output = results[0].get("output", "Consensus failed")

            return {
                "consensus_result": {"status": "failed", "consensus": None},
                "consensus_failed": True,
                "response": fallback_output or "Unable to reach consensus among agents.",
            }

        # 创建/使用策略
        effective_strategy = strategy
        if effective_strategy is None:
            strategy_name = multi_agent_cfg.get("consensus_strategy", "majority_vote")
            task_desc = state.get("input_data", {}).get("prompt", "")
            effective_strategy = create_consensus_strategy(
                strategy_name, judge_llm=judge_llm, task_description=task_desc,
            )

        # 聚合
        try:
            consensus = effective_strategy.aggregate(valid_results, quorum)
            consensus_content = consensus.get("consensus", {})
            # 提取响应文本
            if isinstance(consensus_content, dict):
                response_text = consensus_content.get("output", str(consensus_content))
            elif isinstance(consensus_content, str):
                response_text = consensus_content
            else:
                response_text = str(consensus_content)

            return {
                "consensus_result": {
                    "status": "success",
                    "consensus": consensus,
                    "agreement_count": consensus.get("agreement_count", len(valid_results)),
                    "strategy": consensus.get("strategy", effective_strategy.__class__.__name__),
                },
                "consensus_failed": False,
                "response": response_text,
            }
        except Exception as e:
            logger.error("Consensus aggregation failed: %s", str(e))
            return {
                "consensus_result": {"status": "error", "error": str(e)},
                "consensus_failed": True,
                "response": f"Consensus aggregation error: {e}",
            }

    return _consensus_node
