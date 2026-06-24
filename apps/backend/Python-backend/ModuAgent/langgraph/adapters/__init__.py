"""langgraph.adapters 子包：组件适配器层。

将现有 ModuAgent 组件（BaseTool / BaseReasoningEngine / BaseMemory）
包装为 LangChain / LangGraph 原生类型，保留原接口以支持双轨运行。
"""

from __future__ import annotations
