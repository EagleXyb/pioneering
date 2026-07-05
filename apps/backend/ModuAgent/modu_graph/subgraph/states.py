"""P3-12.3.1 子 Agent 隔离状态定义。

每个子 Agent 使用独立的 ``SubAgentState``，避免并行执行时
多个子 Agent 的 messages 写入主 ``ModuAgentState.messages``
导致顺序非确定（风险 R2）。

子图仅在自身状态空间内操作，结果通过 ``task_output`` 返回，
由主图的 ``consensus_node`` 汇总写入主 state。
"""

from __future__ import annotations

from typing import Annotated, Any, Dict, List, Optional, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class SubAgentState(TypedDict, total=False):
    """子 Agent 独立状态。

    Attributes:
        task_id: 子任务唯一标识（用于结果收集索引）。
        task_type: 子任务类型（research / coding / review 等）。
        task_input: 子任务输入数据（含 prompt / context 等）。
        messages: 子 Agent 独立消息历史（不污染主 state）。
        task_output: 子任务输出结果（由子图填充，consensus_node 读取）。
        trace_id: 继承自主图的链路追踪标识。
        parent_session_id: 父会话标识（用于关联主图 checkpoint）。
        error: 子任务执行错误信息（None=无错误）。
    """

    task_id: str
    task_type: str
    task_input: Dict[str, Any]
    messages: Annotated[List[BaseMessage], add_messages]
    task_output: Optional[Dict[str, Any]]
    trace_id: str
    parent_session_id: str
    error: Optional[str]


def make_subagent_initial_state(
    task_id: str,
    task_type: str,
    task_input: Dict[str, Any],
    trace_id: str = "",
    parent_session_id: str = "",
) -> SubAgentState:
    """构建子 Agent 初始状态。

    Args:
        task_id: 子任务标识
        task_type: 子任务类型
        task_input: 子任务输入
        trace_id: 链路追踪 ID
        parent_session_id: 父会话 ID

    Returns:
        初始化的 SubAgentState
    """
    return SubAgentState(
        task_id=task_id,
        task_type=task_type,
        task_input=task_input,
        messages=[],
        task_output=None,
        trace_id=trace_id,
        parent_session_id=parent_session_id,
        error=None,
    )
