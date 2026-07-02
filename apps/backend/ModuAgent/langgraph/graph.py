"""ModuAgent LangGraph 图构建。

将 coordinator.py 的 process_request 主流程构建为 LangGraph StateGraph，
用图编排替代 1047 行的"上帝类"。

图结构：
    START → perception → [route_after_perception]
                                ├─ memory_query → agent → [route_after_agent]
                                │                                  ├─ tools → agent (ReAct 循环)
                                │                                  └─ END
                                └─ END (熔断)

关键收益：
    - 删除手写 ReAct 循环（约 160 行）
    - 删除 _parse_tool_calls_with_errors / _build_tool_descriptions / _build_native_tools（约 120 行）
    - max_iterations 由 LangGraph recursion_limit 配置
    - max_format_retries 由原生 function calling 消除
"""

from __future__ import annotations

import logging
from typing import Any, List, Optional

from langchain_core.tools import BaseTool as LCTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.graph import CompiledGraph
from langgraph.prebuilt import ToolNode

from langgraph.nodes import (
    make_agent_node,
    make_feedback_node,
    make_memory_query_node,
    make_memory_update_node,
    make_tool_result_processor,
    memory_update_node,
    perception_node,
    response_node,
    route_after_agent,
    route_after_perception,
)
from langgraph.state import ModuAgentState

logger = logging.getLogger(__name__)


class ModuGraph:
    """P1-12.2.3: CompiledGraph 包装类，显式持有 orchestrator 引用。

    替代在 CompiledGraph 实例上 monkey-patch `graph.orchestrator` 的做法：
    第三方对象（CompiledGraph）不应被附加非标准属性，否则会引入隐式契约、
    难以追踪的副作用与类型检查盲区。

    本包装器通过 `__getattr__` 将所有未在自身定义的属性访问透明委托给底层
    编译图（astream / ainvoke / checkpointer / recursion_limit 等），
    同时以普通实例属性形式持有 orchestrator，供 runner 读取以共享
    evolution_collector。

    用法与 CompiledGraph 一致：
        graph = create_agent()        # 返回 ModuGraph
        async for ev in graph.astream(state, config=...): ...
        orch = graph.orchestrator     # 显式属性，非 monkey-patch
    """

    def __init__(self, compiled: CompiledGraph, orchestrator: Any = None) -> None:
        # 必须先设置 _compiled，使后续 __getattr__ 委托可生效
        self._compiled: CompiledGraph = compiled
        # orchestrator 作为显式实例属性（不再 setattr 到 CompiledGraph 上）
        self.orchestrator: Any = orchestrator

    @property
    def compiled(self) -> CompiledGraph:
        """返回底层编译图实例。"""
        return self._compiled

    def __getattr__(self, name: str) -> Any:
        # 仅当属性未在 ModuGraph 自身找到时才委托给底层编译图；
        # 使用 object.__getattribute__ 取 _compiled，避免对自身属性的递归 __getattr__。
        compiled = object.__getattribute__(self, "_compiled")
        return getattr(compiled, name)


def build_modu_graph(
    tools: List[LCTool],
    llm: Any,
    checkpointer: Any = None,
    store: Any = None,
    system_prompt: Optional[str] = None,
    recursion_limit: Optional[int] = None,
    orchestrator: Any = None,
) -> CompiledGraph:
    """构建 ModuAgent LangGraph。

    Args:
        tools: LangChain BaseTool 列表（通过 build_langchain_tools() 构建）
        llm: ChatModel 实例（通过 build_chat_model() 构建）
        checkpointer: 检查点保存器（None=不持久化，MemorySaver=内存持久化）
        store: 长期记忆存储（None=跳过长期记忆查询）
        system_prompt: 系统提示词（可选）
        recursion_limit: 递归限制（对应 max_iterations * 2 + 4）
        orchestrator: EvolutionOrchestrator 实例（None=跳过反馈评估）

    Returns:
        编译后的 StateGraph

    图结构：
        START → perception → route_after_perception
                                  ├─ memory_query → agent → route_after_agent
                                  │                                    ├─ tools → tool_processor → agent
                                  │                                    └─ response → feedback → memory_update → END
                                  └─ response → feedback → memory_update → END (熔断)

    P0-3: memory_update 节点接入图结构，替代 fire-and-forget 异步任务。
    P0-1: feedback 节点接入图结构，接通 feedback/evolution 闭环。
    """
    # 绑定工具到 LLM（原生 function calling）
    bound_llm = llm.bind_tools(tools) if tools else llm

    # 创建图
    graph = StateGraph(ModuAgentState)

    # 创建节点函数
    agent_node = make_agent_node(bound_llm, system_prompt=system_prompt)
    memory_node = make_memory_query_node(store) if store else None
    # P0-3: 创建记忆更新节点（带 Store 时写入长期记忆，否则跳过）
    memory_update = make_memory_update_node(store) if store else memory_update_node
    tool_result_processor = make_tool_result_processor()
    # P0-1: 创建反馈评估节点（有 orchestrator 时评估，否则跳过）
    feedback_node = make_feedback_node(orchestrator) if orchestrator else None

    # 添加节点
    graph.add_node("perception", perception_node)

    if memory_node:
        graph.add_node("memory_query", memory_node)
    else:
        # 无 Store 时使用空查询节点
        from langgraph.nodes import memory_query_node as _empty_memory_node
        graph.add_node("memory_query", _empty_memory_node)

    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(tools) if tools else _noop_tools_node)
    graph.add_node("tool_processor", tool_result_processor)
    graph.add_node("response", response_node)
    # P0-1: 反馈评估节点接入图
    if feedback_node:
        graph.add_node("feedback", feedback_node)
    # P0-3: 记忆更新节点接入图
    graph.add_node("memory_update", memory_update)

    # 添加边
    graph.add_edge(START, "perception")

    # 感知后条件路由：熔断 → response，正常 → memory_query
    graph.add_conditional_edges(
        "perception",
        route_after_perception,
        {
            "memory_query": "memory_query",
            "__end__": "response",
        },
    )

    # 记忆查询后进入 agent
    graph.add_edge("memory_query", "agent")

    # Agent 后条件路由：有 tool_calls → tools，无 tool_calls → response
    graph.add_conditional_edges(
        "agent",
        route_after_agent,
        {
            "tools": "tools",
            "__end__": "response",
        },
    )

    # 工具执行后处理结果，再回到 agent（ReAct 循环）
    graph.add_edge("tools", "tool_processor")
    graph.add_edge("tool_processor", "agent")

    # P0-1/P0-3: response → feedback → memory_update → END
    if feedback_node:
        graph.add_edge("response", "feedback")
        graph.add_edge("feedback", "memory_update")
    else:
        # 无 orchestrator 时直接 response → memory_update
        graph.add_edge("response", "memory_update")
    graph.add_edge("memory_update", END)

    # 编译图
    compile_kwargs: dict[str, Any] = {}
    if checkpointer:
        compile_kwargs["checkpointer"] = checkpointer
    if store:
        compile_kwargs["store"] = store

    compiled = graph.compile(**compile_kwargs)

    # 设置递归限制（对应 max_iterations）
    if recursion_limit:
        compiled.recursion_limit = recursion_limit
    else:
        # 默认：max_reasoning_iterations * 2 + 7（每个 ReAct 循环 2 个节点 + 固定开销含 feedback + memory_update）
        from config.runtime_config import get_config
        config = get_config()
        max_iterations = config.get("llm.max_reasoning_iterations", 3)
        compiled.recursion_limit = max_iterations * 2 + 7

    logger.info(
        "ModuAgent LangGraph built: tools=%d checkpointer=%s store=%s recursion_limit=%d",
        len(tools),
        type(checkpointer).__name__ if checkpointer else "None",
        type(store).__name__ if store else "None",
        compiled.recursion_limit,
    )

    return compiled


def _noop_tools_node(state: ModuAgentState) -> dict:
    """空工具节点（无工具时使用）。"""
    return {}
