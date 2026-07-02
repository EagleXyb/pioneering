"""ModuAgent LangGraph 类型化状态定义。

用 TypedDict 显式声明图状态，替代 coordinator.py 中四处传递的
隐式 context: Dict[str, Any]。

关键映射：
    原 context["history"]         → State.history
    原 context["perception"]      → State.perception_result / cleaned_text
    原 context["native_tools"]    → 由 LangGraph bind_tools 接管
    原 context["tool_results"]    → State.tool_results

获得类型检查与检查点持久化能力。
"""

from __future__ import annotations

from typing import Annotated, Any, Dict, List, Optional, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class ModuAgentState(TypedDict, total=False):
    """ModuAgent LangGraph 图状态。

    Attributes:
        messages: 消息历史（LangGraph 内置 reducer，自动追加）。
        user_id: 用户标识。
        session_id: 会话标识（LangGraph thread_id）。
        trace_id: 链路追踪标识。
        input_data: 原始输入数据（input_type / prompt / required_fields 等）。
        perception_result: 感知层融合结果。
        cleaned_text: 感知清洗后的文本。
        detected_language: 感知检测到的语种。
        sensitivity_level: 敏感度级别（0-5）。
        confidence: 感知置信度。
        injection_detected: 是否检测到 Prompt Injection。
        pii_detected: 是否检测到 PII（个人隐私信息）。
        history: 短期记忆历史（由 Checkpointer 自动管理）。
        knowledge: 长期记忆检索结果。
        tool_results: 工具执行结果列表。
        iteration: ReAct 循环当前迭代次数。
        response: 最终响应文本。
        error_code: 错误码（熔断时填充）。
        error_message: 错误信息（熔断时填充）。
        usage: LLM token 用量统计。
    """

    # 消息历史（LangGraph 内置 reducer，自动追加）
    messages: Annotated[List[BaseMessage], add_messages]

    # 会话标识
    user_id: str
    session_id: str
    trace_id: str

    # 原始输入
    input_data: Dict[str, Any]

    # 感知结果
    perception_result: Optional[Dict[str, Any]]
    cleaned_text: Optional[str]
    detected_language: Optional[str]
    sensitivity_level: int
    confidence: float
    injection_detected: bool
    pii_detected: bool

    # 记忆
    history: List[Dict[str, Any]]
    knowledge: List[Dict[str, Any]]

    # 工具
    tool_results: List[Dict[str, Any]]

    # 元数据
    iteration: int

    # 最终响应
    response: str
    error_code: str
    error_message: str
    usage: Dict[str, int]

    # 记忆更新状态（P0-3: memory_update_node 接入图结构）
    memory_update_status: str

    # 反馈评估与进化（P0-1: feedback/evolution 闭环）
    evaluation: Optional[Dict[str, Any]]
    should_evolve: bool
    evolution_action: Optional[Dict[str, Any]]

    # P0-2: per-session 配置覆盖（由 ParameterTuneStrategy 生成，下一次请求时应用）
    config_overrides: Dict[str, Any]


def make_initial_state(
    user_id: str,
    session_id: str,
    trace_id: str,
    input_data: Dict[str, Any],
) -> ModuAgentState:
    """构建图初始状态。

    Args:
        user_id: 用户标识
        session_id: 会话标识
        trace_id: 链路追踪标识
        input_data: 原始输入数据

    Returns:
        初始化的 ModuAgentState
    """
    return ModuAgentState(
        messages=[],
        user_id=user_id,
        session_id=session_id,
        trace_id=trace_id,
        input_data=input_data,
        perception_result=None,
        cleaned_text=None,
        detected_language=None,
        sensitivity_level=0,
        confidence=1.0,
        injection_detected=False,
        pii_detected=False,
        history=[],
        knowledge=[],
        tool_results=[],
        iteration=0,
        response="",
        error_code="",
        error_message="",
        usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        memory_update_status="",
        evaluation=None,
        should_evolve=False,
        evolution_action=None,
        config_overrides={},
    )
