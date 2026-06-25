"""ModuAgent LangGraph 配置化组件工厂。

用 LangGraph 的 RunnableConfig + configurable 替代
ComponentRegistry.swap_component 的运行时热替换。

提供：
    - build_checkpointer(): 构建检查点保存器（memory / sqlite）
    - build_store(): 构建长期记忆存储（chroma / in_memory）
    - create_agent(): 根据配置创建 ModuAgent LangGraph 实例
    - create_legacy_agent(): 创建 legacy Coordinator（双轨对比）

进化机制映射：
    - 组件热替换 → 重新编译图（create_agent(config=...)）
    - 参数调优 → RunnableConfig 的 configurable 字段动态注入
    - 回滚 → LangGraph 检查点 get_state_history() + update_state()
    - 多版本 → 多个编译图实例并行
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from langchain_core.runnables import RunnableConfig
from langgraph.graph.graph import CompiledGraph

from config.runtime_config import RuntimeConfig, get_config
from langgraph.adapters.llm_adapter import build_chat_model
from langgraph.adapters.store_adapter import ChromaStore, InMemoryStoreAdapter
from langgraph.adapters.tool_adapter import build_langchain_tools
from langgraph.graph import build_modu_graph

logger = logging.getLogger(__name__)


def build_checkpointer(checkpointer_type: str = "memory") -> Any:
    """构建检查点保存器。

    替代 components/memory/cache/redis_adapter.py 的 InMemoryShortTermMemory。
    LangGraph 自动按 thread_id（= session_id）持久化整个 State，
    无需手写 query/update。

    Args:
        checkpointer_type: 检查点类型
            - "memory": 内存检查点（MemorySaver，默认）
            - "sqlite": SQLite 检查点（SqliteSaver，持久化到文件）
            - "none": 无检查点

    Returns:
        Checkpointer 实例，或 None
    """
    if checkpointer_type == "none":
        return None

    if checkpointer_type == "sqlite":
        try:
            from langgraph.checkpoint.sqlite import SqliteSaver
            return SqliteSaver.from_conn_string("checkpoints.db")
        except ImportError:
            logger.warning("SqliteSaver not available, falling back to MemorySaver")
            from langgraph.checkpoint.memory import MemorySaver
            return MemorySaver()

    from langgraph.checkpoint.memory import MemorySaver
    logger.info("Built MemorySaver checkpointer")
    return MemorySaver()


def build_store(store_type: str = "chroma") -> Any:
    """构建长期记忆存储。

    将现有 ChromaLongTermMemory 包装为 LangGraph BaseStore。

    Args:
        store_type: 存储类型
            - "chroma": Chroma 向量存储（默认，复用现有 ChromaLongTermMemory）
            - "in_memory": 内存存储（轻量级，用于测试）
            - "none": 无长期记忆

    Returns:
        BaseStore 实例，或 None
    """
    if store_type == "none":
        return None

    if store_type == "in_memory":
        logger.info("Built InMemoryStoreAdapter")
        return InMemoryStoreAdapter()

    try:
        store = ChromaStore()
        logger.info("Built ChromaStore")
        return store
    except Exception as e:
        logger.warning("ChromaStore init failed (%s), falling back to InMemoryStore", str(e))
        return InMemoryStoreAdapter()


def create_agent(
    config: Optional[RunnableConfig] = None,
    runtime_config: Optional[RuntimeConfig] = None,
    system_prompt: Optional[str] = None,
) -> CompiledGraph:
    """根据配置创建 ModuAgent LangGraph 实例。

    支持通过 config 覆盖运行时参数（如 LLM provider、temperature 等），
    替代 ComponentRegistry.swap_component 的运行时热替换。

    Args:
        config: RunnableConfig，支持 configurable 字段覆盖：
            - llm_provider: LLM 提供商（glm/deepseek/gpt/qwen）
            - temperature: 温度参数
            - max_tokens: 最大 token 数
            - checkpointer_type: 检查点类型
            - store_type: 存储类型
            - tools: 工具名列表
            - system_prompt: 系统提示词
        runtime_config: 运行时配置（默认使用全局单例）
        system_prompt: 系统提示词（优先级低于 config.configurable.system_prompt）

    Returns:
        编译后的 CompiledGraph

    Examples:
        # 默认配置
        graph = create_agent()

        # 运行时覆盖 LLM provider
        graph = create_agent(config={
            "configurable": {"llm_provider": "deepseek", "temperature": 0.5}
        })

        # 热替换工具集
        graph = create_agent(config={
            "configurable": {"tools": ["calculator"]}
        })
    """
    if runtime_config is None:
        runtime_config = get_config()

    configurable: Dict[str, Any] = {}
    if config and "configurable" in config:
        configurable = config["configurable"]

    # LLM provider（支持运行时覆盖）
    provider = configurable.get("llm_provider")
    temperature = configurable.get("temperature")
    max_tokens = configurable.get("max_tokens")

    llm = build_chat_model(
        provider=provider,
        config=runtime_config,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    # 工具（支持运行时覆盖工具集）
    tool_names = configurable.get("tools")
    tools = build_langchain_tools(tool_names=tool_names)

    # 检查点保存器
    checkpointer_type = configurable.get(
        "checkpointer_type",
        runtime_config.get("memory.checkpointer_type", "memory"),
    )
    checkpointer = build_checkpointer(checkpointer_type)

    # 长期记忆存储
    store_type = configurable.get(
        "store_type",
        runtime_config.get("memory.store_type", "chroma"),
    )
    store = build_store(store_type)

    # 系统提示词
    effective_system_prompt = configurable.get("system_prompt", system_prompt)

    # 构建并编译图
    graph = build_modu_graph(
        tools=tools,
        llm=llm,
        checkpointer=checkpointer,
        store=store,
        system_prompt=effective_system_prompt,
    )

    logger.info(
        "ModuAgent LangGraph created: provider=%s tools=%d checkpointer=%s store=%s",
        provider or runtime_config.get("llm.default_provider", "glm"),
        len(tools),
        checkpointer_type,
        store_type,
    )

    return graph


def create_legacy_agent() -> Any:
    """创建 legacy Coordinator 实例（用于双轨运行对比）。

    Returns:
        Coordinator 实例
    """
    from orchestration.coordinator import Coordinator
    return Coordinator()
