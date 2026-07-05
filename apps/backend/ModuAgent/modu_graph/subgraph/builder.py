"""P3-12.3.1 子 Agent 子图构建器。

构建独立的编译子图（mini ReAct 循环），使用 ``SubAgentState`` 隔离。
子图可独立编译运行（避免嵌套递归消耗主图 recursion_limit，规避风险 R1），
也可作为参考实现供 ``make_subagent_node`` 复用核心逻辑。

子图结构：
    START → sub_agent → [route] ── 有 tool_calls → sub_tools → sub_agent (循环)
                              └── 无 tool_calls → sub_finalize → END
"""

from __future__ import annotations

import logging
from typing import Any, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool as LCTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode

from modu_graph.subgraph.states import SubAgentState

logger = logging.getLogger(__name__)

# 子 Agent 默认系统提示词模板（按 task_type 区分）
_SYSTEM_PROMPT_TEMPLATES = {
    "research": (
        "You are a Research Agent. Your task is to investigate and gather information "
        "about the given topic. Provide thorough, factual findings."
    ),
    "coding": (
        "You are a Code Agent. Your task is to write, analyze, or review code "
        "for the given requirement. Provide clear, correct implementations."
    ),
    "review": (
        "You are a Review Agent. Your task is to review and evaluate the given content "
        "for quality, correctness, and completeness. Provide constructive feedback."
    ),
    "default": (
        "You are a specialized Agent. Complete the assigned subtask accurately and concisely."
    ),
}


def _get_system_prompt(task_type: str, custom_prompt: Optional[str] = None) -> str:
    """根据 task_type 获取系统提示词。"""
    if custom_prompt:
        return custom_prompt
    return _SYSTEM_PROMPT_TEMPLATES.get(task_type, _SYSTEM_PROMPT_TEMPLATES["default"])


def _route_after_sub_agent(state: SubAgentState) -> str:
    """子图内 ReAct 路由：有 tool_calls → sub_tools，无 → sub_finalize。"""
    messages = state.get("messages", [])
    if not messages:
        return "sub_finalize"
    last_msg = messages[-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "sub_tools"
    return "sub_finalize"


def build_subagent_subgraph(
    llm: Any,
    tools: Optional[List[LCTool]] = None,
    system_prompt: Optional[str] = None,
    task_type: str = "default",
    recursion_limit: int = 10,
) -> CompiledStateGraph:
    """构建子 Agent 独立编译子图。

    使用 ``SubAgentState`` 实现状态隔离，避免污染主图 ``ModuAgentState.messages``。
    子图拥有独立的 recursion_limit，不计入主图递归预算（规避风险 R1）。

    Args:
        llm: ChatModel 实例（已绑定或未绑定工具均可）
        tools: LangChain 工具列表（None 或空列表=无工具的纯推理子图）
        system_prompt: 自定义系统提示词（None=按 task_type 选择默认模板）
        task_type: 子任务类型（research/coding/review/default）
        recursion_limit: 子图递归限制（默认 10，独立于主图）

    Returns:
        编译后的子图 CompiledStateGraph 实例

    Example:
        >>> subgraph = build_subagent_subgraph(llm, task_type="research")
        >>> result = await subgraph.ainvoke(initial_state)
    """
    effective_tools = tools or []
    bound_llm = llm
    prompt = _get_system_prompt(task_type, system_prompt)

    graph = StateGraph(SubAgentState)

    # --- 子图节点定义 ---

    def sub_agent_node(state: SubAgentState) -> dict:
        """子 Agent 推理节点：调用 LLM 处理子任务。"""
        messages: List[BaseMessage] = list(state.get("messages", []))

        # 若无消息，从 task_input 构建 HumanMessage
        if not messages:
            task_input = state.get("task_input", {})
            prompt_text = task_input.get("prompt", "")
            if not prompt_text:
                prompt_text = str(task_input)
            messages.append(HumanMessage(content=prompt_text))

        # 注入系统提示词
        if not messages or not isinstance(messages[0], SystemMessage):
            messages.insert(0, SystemMessage(content=prompt))

        if not messages:
            return {"task_output": {"status": "error", "message": "No input"}}

        try:
            response = bound_llm.invoke(messages)
            return {"messages": [response]}
        except Exception as e:
            logger.error("Sub-agent LLM invoke failed (task_id=%s): %s", state.get("task_id", ""), str(e))
            return {
                "error": str(e),
                "task_output": {"status": "error", "error": str(e)},
            }

    def sub_finalize_node(state: SubAgentState) -> dict:
        """子图终结节点：提取最终输出为 task_output。"""
        messages = state.get("messages", [])
        response_content = ""
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and msg.content:
                response_content = msg.content
                break

        task_id = state.get("task_id", "")
        task_type_val = state.get("task_type", "default")

        return {
            "task_output": {
                "task_id": task_id,
                "task_type": task_type_val,
                "status": "success",
                "content": response_content,
            }
        }

    def _noop_tools(state: SubAgentState) -> dict:
        """空工具节点（无工具时使用）。"""
        return {}

    # --- 添加节点 ---
    graph.add_node("sub_agent", sub_agent_node)
    if effective_tools:
        graph.add_node("sub_tools", ToolNode(effective_tools))
    else:
        graph.add_node("sub_tools", _noop_tools)
    graph.add_node("sub_finalize", sub_finalize_node)

    # --- 添加边 ---
    graph.add_edge(START, "sub_agent")
    graph.add_conditional_edges(
        "sub_agent",
        _route_after_sub_agent,
        {"sub_tools": "sub_tools", "sub_finalize": "sub_finalize"},
    )
    graph.add_edge("sub_tools", "sub_agent")
    graph.add_edge("sub_finalize", END)

    compiled = graph.compile()
    compiled.recursion_limit = recursion_limit

    logger.info(
        "Subagent subgraph built: task_type=%s tools=%d recursion_limit=%d",
        task_type, len(effective_tools), recursion_limit,
    )

    return compiled
