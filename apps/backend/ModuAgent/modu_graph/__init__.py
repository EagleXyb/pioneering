"""ModuAgent LangGraph 重构模块。

用 LangGraph 的图编排 + 原生 ReAct + 检查点 + 流式替代
ModuAgent 自研的 Coordinator 上帝类 + 手写循环 + 隐式状态 + 自定义事件流。

核心导出：
    - ModuAgentState: 类型化图状态
    - build_modu_graph: StateGraph 构建器
    - create_agent: 配置化组件工厂
    - stream_response / run_sync: 流式与非流式运行入口
"""

from __future__ import annotations

from modu_graph.factory import create_agent
from modu_graph.runner import get_runner
from modu_graph.graph import build_modu_graph
from modu_graph.runner import run_sync, stream_response
from modu_graph.state import ModuAgentState

__all__ = [
    "ModuAgentState",
    "build_modu_graph",
    "create_agent",
    "get_runner",
    "run_sync",
    "stream_response",
]
