// 对应 Python: modu_graph/factory.py
// ModuAgent LangGraph 配置化组件工厂。
//
// 用 LangGraph 的 RunnableConfig + configurable 替代
// ComponentRegistry.swap_component 的运行时热替换。
//
// 提供：
//   - build_checkpointer(): 构建检查点保存器（memory / sqlite）
//   - build_store(): 构建长期记忆存储（chroma / in_memory）
//   - create_agent(): 根据配置创建 ModuAgent LangGraph 实例
//
// 进化机制映射：
//   - 组件热替换 → 重新编译图（create_agent(config=...)）
//   - 参数调优 → RunnableConfig 的 configurable 字段动态注入
//   - 回滚 → LangGraph 检查点 get_state_history() + update_state()
//   - 多版本 → 多个编译图实例并行
//
// 与 Python 版的差异：
//   create_agent 为 async 函数——Node.js 中无法像 Python 那样
//   新建事件循环同步执行 MCP 工具发现（listAllTools 是异步的）。
//   调用方（get_runner / Fastify 路由）天然异步，无额外负担。
import type { RunnableConfig } from '@langchain/core/runnables'

import { getConfig, type RuntimeConfig } from '../config/runtime-config.js'
import { getRegistry } from '../core/registry.js'
import { EvolutionOrchestrator } from '../evolution/evolution-orchestrator.js'
import { getMcpClient } from '../mcp/client.js'
import { SkillLoader } from '../skills/loader.js'
import { SkillPromptAggregator } from '../skills/prompt-aggregator.js'
import { build_chat_model } from './adapters/llm-adapter.js'
import { MCPToolAdapter } from './adapters/mcp-tool-adapter.js'
import { apply_llm_retry } from './adapters/retry.js'
import { ChromaStore, InMemoryStoreAdapter } from './adapters/store-adapter.js'
import { build_langchain_tools } from './adapters/tool-adapter.js'
import { ModuGraph, buildModuGraph } from './graph.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[factory] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[factory] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[factory] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[factory] ${msg}`, ...args),
}

/**
 * 构建检查点保存器。
 *
 * 替代 components/memory/cache/short_term_memory.py 的 InMemoryShortTermMemory。
 * LangGraph 自动按 thread_id（= session_id）持久化整个 State，
 * 无需手写 query/update。
 *
 * @param checkpointerType 检查点类型
 *   - "memory": 内存检查点（MemorySaver，默认）
 *   - "sqlite": SQLite 检查点（SqliteSaver，持久化到文件）
 *   - "none": 无检查点
 * @returns Checkpointer 实例，或 null
 */
export async function build_checkpointer(
  checkpointerType: string = 'memory',
): Promise<any> {
  if (checkpointerType === 'none') {
    return null
  }

  if (checkpointerType === 'sqlite') {
    try {
      // 动态导入 SQLite saver（可选依赖，可能未安装）
      // @ts-expect-error — 可选依赖，可能不存在类型声明
      const mod = await import('@langchain/langgraph-checkpoint-sqlite')
      const SqliteSaver = mod.SqliteSaver ?? mod.default?.SqliteSaver
      if (SqliteSaver) {
        return SqliteSaver.fromConnString('checkpoints.db')
      }
      throw new Error('SqliteSaver not found in module')
    } catch (e: any) {
      logger.warning('SqliteSaver not available, falling back to MemorySaver: %s', String(e))
      const { MemorySaver } = await import('@langchain/langgraph')
      return new MemorySaver()
    }
  }

  // 默认：内存检查点
  const { MemorySaver } = await import('@langchain/langgraph')
  logger.info('Built MemorySaver checkpointer')
  return new MemorySaver()
}

/**
 * 构建长期记忆存储。
 *
 * 将现有 ChromaLongTermMemory 包装为 LangGraph BaseStore。
 *
 * @param storeType 存储类型
 *   - "chroma": Chroma 向量存储（默认，复用现有 ChromaLongTermMemory）
 *   - "in_memory": 内存存储（轻量级，用于测试）
 *   - "none": 无长期记忆
 * @returns BaseStore 实例，或 null
 */
export function build_store(storeType: string = 'chroma'): any {
  if (storeType === 'none') {
    return null
  }

  if (storeType === 'in_memory') {
    logger.info('Built InMemoryStoreAdapter')
    return new InMemoryStoreAdapter()
  }

  try {
    // P2-12.3.2: 从配置读取持久化路径（null=内存模式）
    const persistPath = getConfig().get('memory.chroma_persist_path', null)
    const store = new ChromaStore(null, 'modu_memory', 5, persistPath)
    logger.info('Built ChromaStore (persist_path=%s)', persistPath)
    return store
  } catch (e: any) {
    logger.warning('ChromaStore init failed (%s), falling back to InMemoryStore', String(e))
    return new InMemoryStoreAdapter()
  }
}

/**
 * P2-7: 构造 LLM-as-Judge 评估器。
 *
 * 仅当 `feedback.quality_monitor_mode` 为 "llm" 或 "hybrid" 时构造，
 * 否则返回 null（rule 模式无需 LLM）。
 *
 * 优先使用 `configurable` 中的运行时覆盖（如 API 层指定了 model/provider），
 * 其次读取 `feedback.quality_monitor_llm_provider` 配置，
 * 最后复用 `llm.default_provider`。
 *
 * @param runtimeConfig 运行时配置
 * @param configurable RunnableConfig.configurable 字段
 * @returns ChatOpenAI 实例，或 null（rule 模式或构造失败）
 */
export function _build_judge_llm(
  runtimeConfig: RuntimeConfig,
  configurable: Record<string, any>,
): any | null {
  const mode = runtimeConfig.get('feedback.quality_monitor_mode', 'rule')
  if (mode !== 'llm' && mode !== 'hybrid') {
    return null
  }

  // 评估器 LLM 的 provider 优先级：
  // configurable > feedback.quality_monitor_llm_provider > llm.default_provider
  const provider =
    configurable['llm_provider'] ||
    runtimeConfig.get('feedback.quality_monitor_llm_provider') ||
    runtimeConfig.get('llm.default_provider')
  const temperature = runtimeConfig.get('feedback.quality_monitor_llm_temperature', 0.0)
  const maxTokens = runtimeConfig.get('feedback.quality_monitor_llm_max_tokens', 256)

  try {
    const judgeLlm = build_chat_model(
      provider,
      runtimeConfig,
      temperature,
      maxTokens,
    )
    logger.info(
      'Built LLM-as-Judge evaluator: provider=%s temp=%.2f max_tokens=%d',
      provider, temperature, maxTokens,
    )
    return judgeLlm
  } catch (e: any) {
    logger.warning(
      'Failed to build judge LLM (provider=%s), QualityMonitor will fall back to rule: %s',
      provider, String(e),
    )
    return null
  }
}

/**
 * 从已连接的 MCP Server 发现工具并注册到 ComponentRegistry。
 *
 * 在 create_agent() 构建 LangChain 工具列表之前调用。
 * MCP 工具通过 MCPToolAdapter 适配为 BaseTool 子类，
 * 注册后与内置工具在同一注册表中，build_langchain_tools() 自动取出。
 *
 * 注册是幂等的——已注册的工具跳过。
 * MCPClient 必须已通过 start() 连接 Server
 * （通常在应用 lifespan 中完成）。
 *
 * @param runtimeConfig 运行时配置（未直接使用，保留接口兼容）
 */
export async function _discover_and_register_mcp_tools(
  _runtimeConfig: RuntimeConfig,
): Promise<void> {
  const mcpClient = getMcpClient()
  if (!mcpClient.started) {
    logger.debug('MCPClient not started, skipping MCP tool discovery')
    return
  }

  const registry = getRegistry()

  // 发现所有已连接 Server 的工具
  const mcpTools = await mcpClient.listAllTools()

  let registeredCount = 0
  for (const toolInfo of mcpTools) {
    const adapter = new MCPToolAdapter(toolInfo)
    const toolName = adapter.name()
    // 幂等：已注册则跳过
    if (registry.getTool(toolName) !== undefined) {
      logger.debug("MCP tool '%s' already registered, skip", toolName)
      continue
    }
    try {
      registry.registerTool(adapter)
      registeredCount++
    } catch (e: any) {
      logger.error("Failed to register MCP tool '%s': %s", toolName, String(e))
    }
  }

  if (registeredCount > 0) {
    logger.info(
      'MCP tools registered: %d new, %d total discovered',
      registeredCount, mcpTools.length,
    )
  }
}

/**
 * 根据配置创建 ModuAgent LangGraph 实例。
 *
 * 支持通过 config 覆盖运行时参数（如 LLM provider、temperature 等），
 * 替代 ComponentRegistry.swap_component 的运行时热替换。
 *
 * P1-12.2.3: 返回 ModuGraph 包装器（显式持有 orchestrator 引用），
 * 替代在 CompiledStateGraph 上 monkey-patch `graph.orchestrator`。
 *
 * @param config RunnableConfig，支持 configurable 字段覆盖：
 *   - llm_provider: LLM 提供商（glm/deepseek/gpt/qwen）
 *   - temperature: 温度参数
 *   - max_tokens: 最大 token 数
 *   - model: 模型名
 *   - checkpointer_type: 检查点类型
 *   - store_type: 存储类型
 *   - tools: 工具名列表
 *   - system_prompt: 系统提示词
 * @param runtimeConfig 运行时配置（默认使用全局单例）
 * @param systemPrompt 系统提示词（优先级低于 config.configurable.system_prompt）
 * @returns ModuGraph 包装器（透明委托 CompiledStateGraph 的所有方法）
 *
 * @example
 * // 默认配置
 * const graph = await create_agent()
 *
 * // 运行时覆盖 LLM provider
 * const graph = await create_agent({
 *   configurable: { llm_provider: 'deepseek', temperature: 0.5 }
 * })
 *
 * // 热替换工具集
 * const graph = await create_agent({
 *   configurable: { tools: ['calculator'] }
 * })
 */
export async function create_agent(
  config?: RunnableConfig | null,
  runtimeConfig?: RuntimeConfig | null,
  systemPrompt?: string | null,
): Promise<ModuGraph> {
  if (!runtimeConfig) {
    runtimeConfig = getConfig()
  }

  let configurable: Record<string, any> = {}
  if (config && 'configurable' in config) {
    configurable = (config as any).configurable
  }

  // P1: Skills 动态加载（默认关闭，gated by skills.enabled，零风险）
  // 单一集成点：在构建工具/图之前按配置发现并注册 Skill 及其内含工具。
  if (runtimeConfig.get('skills.enabled', false)) {
    try {
      const loader = new SkillLoader(getRegistry(), runtimeConfig)
      await loader.loadFromConfig()
    } catch (e: any) {
      logger.warning('Skill loading failed, continuing without skills: %s', String(e))
    }
  }

  // LLM provider（支持运行时覆盖）
  const provider = configurable['llm_provider'] ?? null
  const temperature = configurable['temperature'] ?? null
  const maxTokens = configurable['max_tokens'] ?? null
  const model = configurable['model'] ?? null

  const llm = build_chat_model(
    provider,
    runtimeConfig,
    temperature,
    maxTokens,
    model,
  )

  // 工具（支持运行时覆盖工具集；P2-8: 传入 config 启用工具重试）
  // MCP 工具发现：从已连接的 MCP Server 发现远程工具并注册到 ComponentRegistry
  // gated by mcp.enabled（默认关闭，零侵入）；失败不影响 Agent 启动
  if (runtimeConfig.get('mcp.enabled', false)) {
    try {
      await _discover_and_register_mcp_tools(runtimeConfig)
    } catch (e: any) {
      logger.warning('MCP tool discovery failed, continuing without MCP tools: %s', String(e))
    }
  }

  const toolNames = configurable['tools'] ?? null
  const tools = build_langchain_tools(null, toolNames, runtimeConfig)

  // 先绑定工具再应用重试，避免 RunnableRetry 不支持 bind_tools
  let boundLlm = tools.length > 0 ? llm.bindTools(tools) : llm

  // P2-8: 为 LLM 应用重试（指数退避，仅重试瞬时网络异常）
  boundLlm = apply_llm_retry(boundLlm, runtimeConfig)

  // 检查点保存器
  const checkpointerType =
    configurable['checkpointer_type'] ??
    runtimeConfig.get('memory.checkpointer_type', 'memory')
  const checkpointer = await build_checkpointer(checkpointerType)

  // 长期记忆存储
  const storeType =
    configurable['store_type'] ??
    runtimeConfig.get('memory.store_type', 'chroma')
  const store = build_store(storeType)

  // 系统提示词
  let effectiveSystemPrompt = configurable['system_prompt'] ?? systemPrompt ?? null

  // P1: 聚合已注册 Skill 的提示片段（gated by skills.enabled；无 Skill 时返回原提示）
  if (runtimeConfig.get('skills.enabled', false)) {
    try {
      effectiveSystemPrompt = SkillPromptAggregator.aggregate(
        effectiveSystemPrompt, getRegistry(),
      )
    } catch (e: any) {
      logger.warning('Skill prompt aggregation failed, using base prompt: %s', String(e))
    }
  }

  // P0-1: 创建进化编排器（接通 feedback/evolution 闭环）
  // P2-7: 若启用 LLM-as-Judge，构造独立的 judge LLM 并传入 orchestrator
  let orchestrator: EvolutionOrchestrator | null = null
  let judgeLlm: any = null
  if (runtimeConfig.get('feedback.enable_evolution', true)) {
    try {
      judgeLlm = _build_judge_llm(runtimeConfig, configurable)
      orchestrator = new EvolutionOrchestrator(null, null, null, judgeLlm)
      const judgeMode = runtimeConfig.get('feedback.quality_monitor_mode', 'rule')
      logger.info(
        'EvolutionOrchestrator initialized (quality_monitor_mode=%s, judge_llm=%s)',
        judgeMode,
        judgeLlm !== null ? 'enabled' : 'disabled',
      )
    } catch (e: any) {
      logger.warning('EvolutionOrchestrator init failed, feedback loop disabled: %s', String(e))
    }
  }

  // 多 Agent 共识策略为 llm_judge 时传入 judgeLlm
  const consensusStrategy = runtimeConfig.get(
    'orchestration.multi_agent.consensus_strategy', 'majority_vote',
  )
  const graphJudgeLlm = consensusStrategy === 'llm_judge' ? judgeLlm : null

  // 构建并编译图
  const compiled = buildModuGraph(
    tools,
    boundLlm,
    checkpointer,
    store,
    effectiveSystemPrompt,
    null,  // recursionLimit: 使用默认值（在 buildModuGraph 内部根据配置计算）
    orchestrator,
    null,  // hitlEnabled: 从配置读取
    null,  // multiAgentEnabled: 从配置读取
    graphJudgeLlm,
    // P4: 支持 per-request 启用 Plan-Execute（如 agent-bridge 传入
    // configurable.plan_execute_enabled=true 时强制启用），否则从全局配置读取（默认 false）。
    configurable['plan_execute_enabled'] ?? null,
    llm,   // P4: 未绑定工具的原始 LLM，供 Planner 节点使用（规划阶段禁止工具）
  )

  // P1-12.2.3: 通过 ModuGraph wrapper 显式持有 orchestrator 引用，
  // 替代在 CompiledStateGraph 上 monkey-patch `graph.orchestrator` 的做法。
  const graph = new ModuGraph(compiled, orchestrator)

  logger.info(
    'ModuAgent LangGraph created: provider=%s tools=%d checkpointer=%s store=%s',
    provider ?? runtimeConfig.get('llm.default_provider', 'glm'),
    tools.length,
    checkpointerType,
    storeType,
  )

  return graph
}
