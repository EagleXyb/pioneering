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
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode

from modu_graph.nodes import (
    make_agent_node,
    make_consensus_node,
    make_feedback_node,
    make_human_review_node,
    make_memory_query_node,
    make_memory_update_node,
    make_subagent_node,
    make_tool_result_processor,
    memory_update_node,
    perception_node,
    response_node,
    route_after_agent,
    route_after_human_review,
    route_after_memory_query,
    route_after_perception,
)
from modu_graph.state import ModuAgentState
from modu_graph.subgraph.supervisor import make_supervisor_node, route_from_supervisor

logger = logging.getLogger(__name__)


class ModuGraph:
    """P1-12.2.3: CompiledStateGraph 包装类，显式持有 orchestrator 引用。

    替代在 CompiledStateGraph 实例上 monkey-patch `graph.orchestrator` 的做法：
    第三方对象（CompiledStateGraph）不应被附加非标准属性，否则会引入隐式契约、
    难以追踪的副作用与类型检查盲区。

    本包装器通过 `__getattr__` 将所有未在自身定义的属性访问透明委托给底层
    编译图（astream / ainvoke / checkpointer / recursion_limit 等），
    同时以普通实例属性形式持有 orchestrator，供 runner 读取以共享
    evolution_collector。

    用法与 CompiledStateGraph 一致：
        graph = create_agent()        # 返回 ModuGraph
        async for ev in graph.astream(state, config=...): ...
        orch = graph.orchestrator     # 显式属性，非 monkey-patch
    """

    def __init__(self, compiled: CompiledStateGraph, orchestrator: Any = None) -> None:
        # 必须先设置 _compiled，使后续 __getattr__ 委托可生效
        self._compiled: CompiledStateGraph = compiled
        # orchestrator 作为显式实例属性（不再 setattr 到 CompiledStateGraph 上）
        self.orchestrator: Any = orchestrator

    @property
    def compiled(self) -> CompiledStateGraph:
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
    hitl_enabled: Optional[bool] = None,
    multi_agent_enabled: Optional[bool] = None,
    judge_llm: Any = None,
) -> CompiledStateGraph:
    """构建 ModuAgent LangGraph。

    Args:
        tools: LangChain BaseTool 列表（通过 build_langchain_tools() 构建）
        llm: ChatModel 实例（通过 build_chat_model() 构建）
        checkpointer: 检查点保存器（None=不持久化，MemorySaver=内存持久化）
        store: 长期记忆存储（None=跳过长期记忆查询）
        system_prompt: 系统提示词（可选）
        recursion_limit: 递归限制（对应 max_iterations * 2 + 4）
        orchestrator: EvolutionOrchestrator 实例（None=跳过反馈评估）
        hitl_enabled: P3-12.3.2 是否启用人工审批节点；None 时从配置读取
        multi_agent_enabled: P3-12.3.1 是否启用多 Agent 协作；None 时从配置读取
        judge_llm: P3-12.3.1 LLM 裁决器（仅 llm_judge 共识策略需要）

    Returns:
        编译后的 StateGraph

    图结构（multi_agent 关闭，HITL 关闭）：
        START → perception → route_after_perception
                                  ├─ memory_query → agent → route_after_agent
                                  │                                    ├─ tools → tool_processor → agent
                                  │                                    └─ response → feedback → memory_update → END
                                  └─ response → feedback → memory_update → END (熔断)

    图结构（multi_agent 开启，P3-12.3.1）：
        START → perception → route_after_perception
                                  ├─ memory_query → route_after_memory_query
                                  │                    ├─ supervisor → route_from_supervisor (Send × N)
                                  │                    │                ├─ subagent_run → consensus → response
                                  │                    └─ agent (multi_agent 关闭时)
                                  └─ response (熔断)

    P3-12.3.1: supervisor + subagent_run + consensus 节点接入图结构。
    P3-12.3.2: human_review 节点接入图结构，敏感工具执行前 interrupt 等待人工审批。
    """
    # LLM 已经在 factory 中绑定了工具，此处直接使用
    bound_llm = llm

    # 读取 HITL 配置（P3-12.3.2）
    if hitl_enabled is None:
        from config.runtime_config import get_config as _get_cfg
        try:
            hitl_enabled = bool(_get_cfg().get("tools.human_in_loop.enabled", False))
        except Exception:
            hitl_enabled = False

    # 读取多 Agent 配置（P3-12.3.1）
    if multi_agent_enabled is None:
        from config.runtime_config import get_config as _get_cfg
        try:
            multi_agent_enabled = bool(_get_cfg().get("orchestration.multi_agent.enabled", False))
        except Exception:
            multi_agent_enabled = False

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
    # P3-12.3.2: 人工审批节点（HITL 开启时插入 agent → tools 之间）
    human_review_node = make_human_review_node() if hitl_enabled else None
    # P3-12.3.1: 多 Agent 协作节点（multi_agent 开启时替代单 agent 路径）
    supervisor_node = None
    subagent_node = None
    consensus_node = None
    if multi_agent_enabled:
        supervisor_node = make_supervisor_node()
        subagent_node = make_subagent_node(bound_llm, system_prompt=system_prompt)
        consensus_node = make_consensus_node(judge_llm=judge_llm)

    # 添加节点
    graph.add_node("perception", perception_node)

    if memory_node:
        graph.add_node("memory_query", memory_node)
    else:
        # 无 Store 时使用空查询节点
        from modu_graph.nodes import memory_query_node as _empty_memory_node
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
    # P3-12.3.2: 人工审批节点接入图
    if human_review_node:
        graph.add_node("human_review", human_review_node)
    # P3-12.3.1: 多 Agent 协作节点接入图
    if supervisor_node:
        graph.add_node("supervisor", supervisor_node)
        graph.add_node("subagent_run", subagent_node)
        graph.add_node("consensus", consensus_node)

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

    # 记忆查询后进入 agent 或 supervisor（P3-12.3.1 多 Agent 路由）
    if supervisor_node:
        graph.add_conditional_edges(
            "memory_query",
            route_after_memory_query,
            {"agent": "agent", "supervisor": "supervisor"},
        )
        # Supervisor 通过 Send API 并行分发到 subagent_run
        graph.add_conditional_edges(
            "supervisor",
            route_from_supervisor,
            ["subagent_run"],
        )
        # subagent_run 完成后进入 consensus
        graph.add_edge("subagent_run", "consensus")
        # consensus → response（进入响应阶段）
        graph.add_edge("consensus", "response")
    else:
        graph.add_edge("memory_query", "agent")

    # Agent 后条件路由：
    # - HITL 关闭: 有 tool_calls → tools，无 tool_calls → response（原行为）
    # - HITL 开启: 有 tool_calls → human_review，无 tool_calls → response（P3-12.3.2）
    if human_review_node:
        graph.add_conditional_edges(
            "agent",
            route_after_agent,
            {
                "tools": "human_review",  # P3-12.3.2: 改路由到 human_review
                "__end__": "response",
            },
        )
        # human_review 后条件路由：通过 → tools，拒绝/错误 → response
        graph.add_conditional_edges(
            "human_review",
            route_after_human_review,
            {
                "tools": "tools",
                "response": "response",
            },
        )
    else:
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
        # P3-12.3.2: HITL 开启时额外加 2（human_review + 路由开销）
        # P3-12.3.1: multi_agent 开启时额外加 4（supervisor + subagent_run + consensus + 路由开销）
        from config.runtime_config import get_config
        config = get_config()
        max_iterations = config.get("llm.max_reasoning_iterations", 3)
        base_limit = max_iterations * 2 + 7
        if human_review_node:
            base_limit += 2  # 为 human_review 节点预留递归预算
        if supervisor_node:
            base_limit += 4  # 为 supervisor + subagent + consensus 预留递归预算
        compiled.recursion_limit = base_limit

    logger.info(
        "ModuAgent LangGraph built: tools=%d checkpointer=%s store=%s recursion_limit=%d hitl=%s multi_agent=%s",
        len(tools),
        type(checkpointer).__name__ if checkpointer else "None",
        type(store).__name__ if store else "None",
        compiled.recursion_limit,
        "enabled" if human_review_node else "disabled",
        "enabled" if supervisor_node else "disabled",
    )

    return compiled


def _noop_tools_node(state: ModuAgentState) -> dict:
    """空工具节点（无工具时使用）。"""
    return {}
