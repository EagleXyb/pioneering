"""ModuAgent LangGraph 配置化组件工厂。

用 LangGraph 的 RunnableConfig + configurable 替代
ComponentRegistry.swap_component 的运行时热替换。

提供：
    - build_checkpointer(): 构建检查点保存器（memory / sqlite）
    - build_store(): 构建长期记忆存储（chroma / in_memory）
    - create_agent(): 根据配置创建 ModuAgent LangGraph 实例

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
from langgraph.graph.state import CompiledStateGraph

from config.runtime_config import RuntimeConfig, get_config
from modu_graph.adapters.llm_adapter import build_chat_model
from modu_graph.adapters.retry import apply_llm_retry
from modu_graph.adapters.store_adapter import ChromaStore, InMemoryStoreAdapter
from modu_graph.adapters.tool_adapter import build_langchain_tools
from modu_graph.graph import ModuGraph, build_modu_graph

logger = logging.getLogger(__name__)


def build_checkpointer(checkpointer_type: str = "memory") -> Any:
    """构建检查点保存器。

    替代 components/memory/cache/short_term_memory.py 的 InMemoryShortTermMemory。
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
        # P2-12.3.2: 从配置读取持久化路径（None=内存模式）
        persist_path = get_config().get("memory.chroma_persist_path", None)
        store = ChromaStore(persist_path=persist_path)
        logger.info("Built ChromaStore (persist_path=%s)", persist_path)
        return store
    except Exception as e:
        logger.warning("ChromaStore init failed (%s), falling back to InMemoryStore", str(e))
        return InMemoryStoreAdapter()


def _build_judge_llm(
    runtime_config: RuntimeConfig,
    configurable: Dict[str, Any],
) -> Optional[Any]:
    """P2-7: 构造 LLM-as-Judge 评估器。

    仅当 `feedback.quality_monitor_mode` 为 "llm" 或 "hybrid" 时构造，
    否则返回 None（rule 模式无需 LLM）。

    优先使用 `configurable` 中的运行时覆盖（如 API 层指定了 model/provider），
    其次读取 `feedback.quality_monitor_llm_provider` 配置，
    最后复用 `llm.default_provider`。

    Args:
        runtime_config: 运行时配置
        configurable: RunnableConfig.configurable 字段

    Returns:
        ChatOpenAI 实例，或 None（rule 模式或构造失败）
    """
    mode = runtime_config.get("feedback.quality_monitor_mode", "rule")
    if mode not in ("llm", "hybrid"):
        return None

    # 评估器 LLM 的 provider 优先级：configurable > feedback.quality_monitor_llm_provider > llm.default_provider
    provider = (
        configurable.get("llm_provider")
        or runtime_config.get("feedback.quality_monitor_llm_provider")
        or runtime_config.get("llm.default_provider")
    )
    temperature = runtime_config.get("feedback.quality_monitor_llm_temperature", 0.0)
    max_tokens = runtime_config.get("feedback.quality_monitor_llm_max_tokens", 256)

    try:
        judge_llm = build_chat_model(
            provider=provider,
            config=runtime_config,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        logger.info(
            "Built LLM-as-Judge evaluator: provider=%s temp=%.2f max_tokens=%d",
            provider, temperature, max_tokens,
        )
        return judge_llm
    except Exception as e:
        logger.warning(
            "Failed to build judge LLM (provider=%s), QualityMonitor will fall back to rule: %s",
            provider, str(e),
        )
        return None


def _discover_and_register_mcp_tools(runtime_config: RuntimeConfig) -> None:
    """从已连接的 MCP Server 发现工具并注册到 ComponentRegistry。

    在 ``create_agent()`` 构建 LangChain 工具列表之前调用。
    MCP 工具通过 ``MCPToolAdapter`` 适配为 ``BaseTool`` 子类，
    注册后与内置工具在同一注册表中，``build_langchain_tools()`` 自动取出。

    注册是幂等的——已注册的工具跳过。
    MCPClient 必须已通过 ``start()`` 连接 Server
    （通常在应用 lifespan 中完成）。

    Args:
        runtime_config: 运行时配置
    """
    import asyncio

    from core.registry import get_registry
    from mcp.client import get_mcp_client
    from modu_graph.adapters.mcp_tool_adapter import MCPToolAdapter

    mcp_client = get_mcp_client()
    if not mcp_client.started:
        logger.debug("MCPClient not started, skipping MCP tool discovery")
        return

    registry = get_registry()

    # 发现所有已连接 Server 的工具
    loop = asyncio.new_event_loop()
    try:
        mcp_tools = loop.run_until_complete(mcp_client.list_all_tools())
    finally:
        loop.close()

    registered_count = 0
    for tool_info in mcp_tools:
        adapter = MCPToolAdapter(tool_info)
        tool_name = adapter.name()
        # 幂等：已注册则跳过
        if registry.get_tool(tool_name) is not None:
            logger.debug("MCP tool '%s' already registered, skip", tool_name)
            continue
        try:
            registry.register_tool(adapter)
            registered_count += 1
        except Exception as e:  # noqa: BLE001
            logger.error("Failed to register MCP tool '%s': %s", tool_name, e)

    if registered_count > 0:
        logger.info("MCP tools registered: %d new, %d total discovered",
                    registered_count, len(mcp_tools))


def create_agent(
    config: Optional[RunnableConfig] = None,
    runtime_config: Optional[RuntimeConfig] = None,
    system_prompt: Optional[str] = None,
) -> ModuGraph:
    """根据配置创建 ModuAgent LangGraph 实例。

    支持通过 config 覆盖运行时参数（如 LLM provider、temperature 等），
    替代 ComponentRegistry.swap_component 的运行时热替换。

    P1-12.2.3: 返回 ModuGraph 包装器（显式持有 orchestrator 引用），
    替代在 CompiledStateGraph 上 monkey-patch `graph.orchestrator`。

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
        ModuGraph 包装器（透明委托 CompiledStateGraph 的所有方法）

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

    # P1: Skills 动态加载（默认关闭，gated by skills.enabled，零风险）
    # 单一集成点：在构建工具/图之前按配置发现并注册 Skill 及其内含工具。
    if runtime_config.get("skills.enabled", False):
        try:
            from skills.loader import SkillLoader
            SkillLoader(get_registry(), runtime_config).load_from_config()
        except Exception as e:  # noqa: BLE001
            logger.warning("Skill loading failed, continuing without skills: %s", e)

    # LLM provider（支持运行时覆盖）
    provider = configurable.get("llm_provider")
    temperature = configurable.get("temperature")
    max_tokens = configurable.get("max_tokens")
    model = configurable.get("model")

    llm = build_chat_model(
        provider=provider,
        config=runtime_config,
        temperature=temperature,
        max_tokens=max_tokens,
        model=model,
    )

    # 工具（支持运行时覆盖工具集；P2-8: 传入 config 启用工具重试）
    # MCP 工具发现：从已连接的 MCP Server 发现远程工具并注册到 ComponentRegistry
    # gated by mcp.enabled（默认关闭，零侵入）；失败不影响 Agent 启动
    if runtime_config.get("mcp.enabled", False):
        try:
            _discover_and_register_mcp_tools(runtime_config)
        except Exception as e:  # noqa: BLE001
            logger.warning("MCP tool discovery failed, continuing without MCP tools: %s", e)

    tool_names = configurable.get("tools")
    tools = build_langchain_tools(tool_names=tool_names, config=runtime_config)

    # 先绑定工具再应用重试，避免 RunnableRetry 不支持 bind_tools
    bound_llm = llm.bind_tools(tools) if tools else llm

    # P2-8: 为 LLM 应用重试（指数退避，仅重试瞬时网络异常）
    bound_llm = apply_llm_retry(bound_llm, runtime_config)

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

    # P1: 聚合已注册 Skill 的提示片段（gated by skills.enabled；无 Skill 时返回原提示）
    if runtime_config.get("skills.enabled", False):
        try:
            from skills.prompt_aggregator import SkillPromptAggregator
            effective_system_prompt = SkillPromptAggregator.aggregate(
                effective_system_prompt, get_registry()
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("Skill prompt aggregation failed, using base prompt: %s", e)

    # P0-1: 创建进化编排器（接通 feedback/evolution 闭环）
    # P2-7: 若启用 LLM-as-Judge，构造独立的 judge LLM 并传入 orchestrator
    orchestrator = None
    if runtime_config.get("feedback.enable_evolution", True):
        try:
            from evolution.evolution_orchestrator import EvolutionOrchestrator
            judge_llm = _build_judge_llm(runtime_config, configurable)
            orchestrator = EvolutionOrchestrator(evaluator_llm=judge_llm)
            judge_mode = runtime_config.get("feedback.quality_monitor_mode", "rule")
            logger.info(
                "EvolutionOrchestrator initialized (quality_monitor_mode=%s, judge_llm=%s)",
                judge_mode,
                "enabled" if judge_llm is not None else "disabled",
            )
        except Exception as e:
            logger.warning("EvolutionOrchestrator init failed, feedback loop disabled: %s", str(e))

    # 构建并编译图
    compiled = build_modu_graph(
        tools=tools,
        llm=bound_llm,
        checkpointer=checkpointer,
        store=store,
        system_prompt=effective_system_prompt,
        orchestrator=orchestrator,
        multi_agent_enabled=runtime_config.get("orchestration.multi_agent.enabled", False),
        judge_llm=judge_llm if runtime_config.get(
            "orchestration.multi_agent.consensus_strategy", "majority_vote"
        ) == "llm_judge" else None,
    )

    # P1-12.2.3: 通过 ModuGraph wrapper 显式持有 orchestrator 引用，
    # 替代在 CompiledStateGraph 上 monkey-patch `graph.orchestrator` 的做法。
    graph = ModuGraph(compiled=compiled, orchestrator=orchestrator)

    logger.info(
        "ModuAgent LangGraph created: provider=%s tools=%d checkpointer=%s store=%s",
        provider or runtime_config.get("llm.default_provider", "glm"),
        len(tools),
        checkpointer_type,
        store_type,
    )

    return graph
