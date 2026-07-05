"""P3-12.3.1 Supervisor 节点：任务拆分 + Send 并行分发。

Supervisor 分析用户输入，将其拆分为多个子任务（research/coding/review 等），
通过 LangGraph ``Send`` API 并行分发到 ``subagent_run`` 节点。

数据流：
    Supervisor Node
        ↓ return {"subtasks": [...]}
    route_from_supervisor (conditional edge)
        ↓ return [Send("subagent_run", {"current_subtask": task}) ...]
    subagent_run × N (并行执行)
        ↓ return {"subtask_results": {task_id: result}}
    consensus_node (汇总)

关键设计：
    - 任务拆分尊重 ``orchestration.multi_agent.max_subagents`` 上限
    - 每个子任务携带唯一 task_id，结果按 task_id 收集
    - ``current_subtask`` 为 transient 字段，仅 Send 携带，节点不返回
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Callable, Dict, List

from config.runtime_config import get_config
from modu_graph.state import ModuAgentState

logger = logging.getLogger(__name__)

# 默认子任务类型模板（按用户输入拆分为多视角子任务）
_DEFAULT_TASK_TYPES = ["research", "coding", "review"]


def decompose_task(
    state: ModuAgentState,
    max_subagents: int = 5,
    task_types: List[str] | None = None,
) -> List[Dict[str, Any]]:
    """将用户输入拆分为多个子任务。

    拆分策略（规则化，确保确定性 + 可测试）：
        - 按配置的 task_types 列表为每个类型创建一个子任务
        - 每个子任务携带相同 prompt 但不同 task_type（视角）
        - 子任务数不超过 max_subagents

    生产环境可替换为 LLM 拆分（调用 LLM 分析任务并生成子任务列表），
    此处使用规则化方案确保确定性测试。

    Args:
        state: 主图状态
        max_subagents: 最大子 Agent 数量上限
        task_types: 自定义任务类型列表（None=使用默认 research/coding/review）

    Returns:
        子任务列表，每个元素含 task_id / task_type / task_input
    """
    types = task_types or _DEFAULT_TASK_TYPES
    # 限制子任务数不超过 max_subagents
    types = types[:max_subagents]

    input_data = state.get("input_data", {})
    prompt = input_data.get("prompt", "") or state.get("cleaned_text", "")
    trace_id = state.get("trace_id", "")
    session_id = state.get("session_id", "")

    subtasks: List[Dict[str, Any]] = []
    for task_type in types:
        task_id = f"{task_type}_{uuid.uuid4().hex[:8]}"
        subtasks.append({
            "task_id": task_id,
            "task_type": task_type,
            "task_input": {
                "prompt": prompt,
                "task_type": task_type,
                "trace_id": trace_id,
                "session_id": session_id,
            },
        })

    logger.info(
        "Task decomposed into %d subtasks: types=%s trace_id=%s",
        len(subtasks), [t["task_type"] for t in subtasks], trace_id,
    )
    return subtasks


def make_supervisor_node(
    max_subagents: int | None = None,
    task_types: List[str] | None = None,
) -> Callable[[ModuAgentState], dict]:
    """创建 Supervisor 节点函数。

    Supervisor 节点职责：
        1. 从 state 读取用户输入
        2. 调用 ``decompose_task`` 拆分子任务
        3. 将子任务列表写入 state（供 Send 路由函数读取）
        4. 重置 subtask_results（清空上一轮结果）

    Send 分发由 ``route_from_supervisor`` 条件路由函数完成（返回 Send 列表）。

    Args:
        max_subagents: 最大子 Agent 数（None=从配置读取）
        task_types: 自定义任务类型列表（None=使用默认）

    Returns:
        Supervisor 节点函数
    """

    def _supervisor_node(state: ModuAgentState) -> dict:
        """Supervisor 节点：拆分任务并准备 Send 分发。"""
        config = get_config()
        multi_agent_cfg = config.get("orchestration.multi_agent", {})

        effective_max = max_subagents if max_subagents is not None else multi_agent_cfg.get("max_subagents", 5)

        subtasks = decompose_task(state, max_subagents=effective_max, task_types=task_types)

        if not subtasks:
            logger.warning("Supervisor produced no subtasks, falling back to empty")
            return {
                "subtasks": [],
                "subtask_results": {},
                "consensus_failed": True,
            }

        return {
            "subtasks": subtasks,
            "subtask_results": {},  # 重置，收集本轮子任务结果
            "consensus_failed": False,
        }

    return _supervisor_node


def route_from_supervisor(state: ModuAgentState) -> List[Any]:
    """Supervisor 条件路由：返回 Send 列表并行分发子任务。

    从 state 读取 ``subtasks``，为每个子任务生成一个 ``Send`` 对象，
    目标节点为 ``subagent_run``，携带 ``current_subtask`` 数据。

    LangGraph 会并行调度所有 Send，各子任务独立执行后结果通过
    ``merge_subtask_results`` reducer 合并到 ``subtask_results``。

    Args:
        state: 当前图状态

    Returns:
        Send 对象列表（每个子任务一个）；无子任务时返回空列表走 END
    """
    try:
        from langgraph.types import Send
    except ImportError as e:
        logger.error("langgraph.types.Send unavailable: %s", str(e))
        return []

    subtasks = state.get("subtasks", [])
    if not subtasks:
        return []

    sends = []
    for task in subtasks:
        sends.append(Send("subagent_run", {"current_subtask": task}))

    logger.debug("Supervisor dispatching %d Send(s) to subagent_run", len(sends))
    return sends
