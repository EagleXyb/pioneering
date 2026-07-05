"""P3-12.3.1 多 Agent 协作：Subgraph 模块。

提供子 Agent 独立状态隔离、子图构建器与 Supervisor 分发调度：

    SubAgentState        —— 子 Agent 隔离状态（避免污染主 ModuAgentState.messages）
    build_subagent_subgraph —— 构建独立编译子图（mini ReAct 循环）
    make_supervisor_node    —— Supervisor 节点工厂（任务拆分 + Send 并行分发）
    decompose_task          —— 任务拆分工具函数

架构参考：docs/重构/P3功能扩展_技术方案.md §3.1.3 技术路线
"""

from __future__ import annotations

from modu_graph.subgraph.builder import build_subagent_subgraph
from modu_graph.subgraph.states import SubAgentState
from modu_graph.subgraph.supervisor import decompose_task, make_supervisor_node

__all__ = [
    "SubAgentState",
    "build_subagent_subgraph",
    "decompose_task",
    "make_supervisor_node",
]
