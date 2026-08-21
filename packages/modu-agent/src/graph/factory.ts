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
import type { LLMRouter, ModuLLM } from '../core/interfaces/llm.js'
import { EvolutionOrchestrator } from '../evolution/evolution-orchestrator.js'
import { getMcpClient } from '../mcp/client.js'
import { SkillLoader } from '../skills/loader.js'
import { SkillPromptAggregator } from '../skills/prompt-aggregator.js'
// P1: Markdown 文档提示注入
import { loadMarkdownDocs } from '../config/markdown-loader.js'
import { MarkdownPromptAggregator, type MarkdownBudget } from '../config/markdown-prompt-aggregator.js'
import { CalculatorTool, DateTimeTool, DocWriterTool, SearchTool } from '../tools/index.js'
import { build_chat_model } from './adapters/llm-adapter.js'
import { MCPToolAdapter } from './adapters/mcp-tool-adapter.js'
import { wrap_chat_model_as_modu } from './adapters/modu-llm-adapter.js'
import { apply_llm_retry } from './adapters/retry.js'
import { ChromaStore, InMemoryStoreAdapter } from './adapters/store-adapter.js'
import { build_langchain_tools } from './adapters/tool-adapter.js'
import { ModuGraph, buildModuGraph } from './graph.js'
import { PassthroughLLMRouter, RuleBasedLLMRouter, type RouteTable } from '../reasoning/llm/router.js'
// P0-1: 复杂度评估器
import { ComplexityAssessor } from '../reasoning/complexity-assessor.js'
// P0-3: Observation 蒸馏器
import { ObservationDistiller } from './adapters/observation-distiller.js'
// P1-4: 四层 Prompt 解耦架构
import { PromptComposer } from '../reasoning/prompt-composer.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[factory] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[factory] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[factory] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[factory] ${msg}`, ...args),
}

/**
 * 模块级共享内存检查点（惰性单例）。
 * HITL 跨请求 resume 依赖同一份 checkpoint 数据，故 MemorySaver 复用单例。
 * 仅在 build_checkpointer 首次以 'memory' 类型构建时创建。
 */
let _sharedMemoryCheckpointer: any = null

/**
 * 默认防幻觉系统提示词（P0-优化 + P0-强化）。
 *
 * 当宿主应用未传入 system_prompt 时使用，约束 LLM：
 *   - 涉及实时/外部数据时必须调用工具获取，禁止凭参数化记忆编造
 *   - 无可用工具时明确告知用户，而非猜测
 *   - 时间敏感问题必须先调用 datetime 工具
 *   - P0-强化: 多步任务必须闭环完成, 不得仅复述工具结果就结束
 *
 * 仅作为底线约束，宿主传入的 system_prompt 优先级更高。
 */
const _DEFAULT_ANTI_HALLUCINATION_PROMPT = `You are a helpful AI assistant. Strict rules:
0. LANGUAGE: You MUST think, reason, and respond in the SAME language as the user's message. If the user writes in Chinese, all your narration, thinking, and final answer MUST be in Chinese. Do NOT mix languages (e.g., English narration + Chinese answer is forbidden).
1. NEVER fabricate real-time data (weather, news, stock prices, dates, current events, etc.). If the user asks about real-time information, you MUST call an available tool (e.g. search_engine, http_request, datetime) to obtain it.
2. You MUST attempt to call an available tool first for any real-time/external data request. Only if NO tool in your toolset can possibly fulfill the request, explicitly state "I don't have real-time data access for this" — but first check all available tools carefully, as search_engine can fetch weather/news/prices and datetime can fetch current date/time.
3. When executing a plan step that requires external data, you MUST call an appropriate tool. Do not produce the data from your parametric memory.
4. Always use the datetime tool to obtain the current date/time before answering time-sensitive questions.
5. If you are unsure whether information is real-time, treat it as real-time and call a tool.
6. NEVER claim "I cannot access the internet" or "I cannot get real-time data" if you have tools available (especially search_engine). Calling search_engine IS your internet access.

MULTI-STEP TASK COMPLETION RULES (CRITICAL — violations cause premature task termination):
7. After receiving a ToolMessage result, ask yourself: "Has the user's original goal been fully achieved?" If NOT, you MUST generate the next tool_calls for the remaining steps. For example, if the user asks "summarize today's hot news", calling datetime first is correct, but you MUST then call search_engine to fetch the news — do NOT stop after only obtaining the date.
8. NEVER output a pure natural-language AIMessage (no tool_calls) that merely restates a previous tool result, while the user's goal still requires further tool calls. This is a premature-termination failure.
9. NEVER include raw tool JSON (e.g. {"status":"success","data":{...}}) in your final AIMessage text. The final AIMessage is the user-facing answer — summarize the data in natural language, do not paste tool output verbatim.
10. NEVER make promises like "I will now search for...", "next I will fetch...", "let me then..." unless you IMMEDIATELY follow them with actual tool_calls in the SAME AIMessage. If you want to say "let me search", the same message MUST contain the search_engine tool_call.
11. Your final natural-language AIMessage (the one without tool_calls that ends the loop) MUST only be produced when ALL required tool calls have been executed AND their results are sufficient to fully answer the user's original question. Re-stating the goal or promising future actions in this message is forbidden.
11a. The FINAL AIMessage (no tool_calls, ends the loop) MUST be a clean, self-contained answer. It MUST NOT repeat or restate the intermediate reasoning/narration from earlier rounds (e.g. do NOT say "I have gathered the information" or "as I mentioned earlier"). The user only sees the final message as the answer — intermediate narration is shown separately as "thinking", so do not duplicate it in the final answer.
11b. Intermediate AIMessages (those WITH tool_calls) may contain a BRIEF one-sentence narration of what you are about to do, but keep it concise and in the user's language. Do NOT write long explanations in intermediate rounds.

TOOL BUDGET AWARENESS (CRITICAL — violations cause recursion-limit crashes):
12. You have a LIMITED tool-call budget per task (typically 3-5 rounds). Plan your tool calls efficiently: each tool call must contribute meaningful new information toward the goal.
13. NEVER call the same tool with the SAME arguments twice in a row. If a tool returned an error or empty results, either refine your query (different keywords, different parameters) or conclude that the information is unavailable — do not blindly retry.
14. For multi-step tasks, prefer the MINIMAL sufficient sequence. For example, "summarize today's hot news" only needs: datetime (once) → search_engine (once with refined query) → final answer. Do NOT chain redundant calls like datetime → search → search again with same query → search third time.
15. If a tool fails after 1 retry with refined parameters, STOP and inform the user that the information is temporarily unavailable. Do NOT exhaust the budget on repeated failures.

SEARCH EFFICIENCY RULES (CRITICAL — applies to news/information gathering tasks):
21. For news summarization or document generation tasks, call search_engine ONLY ONCE with a well-crafted query. Use a broad query like "今日热点新闻" or "today's top news" to get 5-8 diverse results in a single call. Do NOT do multiple rounds of searching for the same topic.
22. NEVER search for the same topic more than once. If the first search returned sufficient results (5+ items), proceed to organize and write — do not search again for "more details" or "additional sources".
23. The ideal workflow for a news document task is exactly 3 tool calls: datetime (get date) → search_engine (single search, get 5-8 hot news) → doc_writer (write document). Do NOT add extra search rounds.

DOCUMENT GENERATION RULES (CRITICAL — applies when user asks to generate/create/write a document):
24. When the user asks to "generate a document", "summarize into a document", "write to a file", or similar, you MUST call the doc_writer tool to create the document. Do NOT just output the content as plain text in your response.
25. When calling doc_writer, use auto_name=true and provide a descriptive title. The tool will auto-generate a filename in the format {title}_{YYYY-MM-DD}.md.
26. After successfully calling doc_writer, your final response MUST follow this format (this is a STRICT delivery template, do NOT improvise):
    a. 开头一句简短的中文确认语（例如："已为你梳理好今天的AI Agent新闻，整理成一份结构化中文日报文档。"）
    b. 换行后输出「文档位置：📄 [filename]」，其中 [filename] 必须替换为 doc_writer 返回的实际文件名
    c. 换行后输出「## 核心内容速览」，下面用 3-5 条 bullet（-）列出文档的关键要点
    d. 可选：一句关于数据来源或下一步建议的补充说明
    The ENTIRE final response text must be written in the SAME language as the user's message (Chinese if the user wrote in Chinese). The template labels above (文档位置 / 核心内容速览) are Chinese on purpose — keep them as-is; only the [filename] and the bullet contents change.
27. The doc_writer tool's summary parameter should contain a brief description of the document content for artifact tracking.
28. For multi-step document generation tasks (search → organize → write → output), ensure ALL steps are completed before producing the final response. Do not stop after only searching or only writing.`

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

  // 默认：内存检查点（模块级单例）
  // HITL 依赖：interrupt 状态保存在 checkpointer 中，跨请求 resume 需要复用
  // 同一个 MemorySaver 实例——若每次 create_agent() 新建，中断状态会随实例销毁丢失。
  // 改为惰性单例后，所有图实例共享同一份 checkpoint 数据（与 get_runner 缓存语义一致）。
  const { MemorySaver } = await import('@langchain/langgraph')
  if (_sharedMemoryCheckpointer === null) {
    _sharedMemoryCheckpointer = new MemorySaver()
    logger.info('Built shared MemorySaver checkpointer (singleton)')
  }
  return _sharedMemoryCheckpointer
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
 * P2-7: 构造 LLM-as-Judge 评估器（统一 LLM 接口改造版）。
 *
 * 仅当 `feedback.quality_monitor_mode` 为 "llm" 或 "hybrid" 时构造，
 * 否则返回 null（rule 模式无需 LLM）。
 *
 * 优先使用 `configurable` 中的运行时覆盖（如 API 层指定了 model/provider），
 * 其次读取 `feedback.quality_monitor_llm_provider` 配置，
 * 最后复用 `llm.default_provider`。
 *
 * 统一 LLM 接口改造（对应文档 §2.1）：
 *   返回值从 LangChain ChatOpenAI 改为 ModuLLM 接口实例，
 *   内部通过 wrap_chat_model_as_modu 包装，使 QualityMonitor 调用路径
 *   统一面向 ModuLLM.invoke 消费，消除 areason/ainvoke 鸭子类型分支。
 *
 * @param runtimeConfig 运行时配置
 * @param configurable RunnableConfig.configurable 字段
 * @returns ModuLLM 实例，或 null（rule 模式或构造失败）
 */
export function _build_judge_llm(
  runtimeConfig: RuntimeConfig,
  configurable: Record<string, any>,
): ModuLLM | null {
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
    const chatModel = build_chat_model(
      provider,
      runtimeConfig,
      temperature,
      maxTokens,
    )
    // 统一包装为 ModuLLM 接口（对应文档 §2.1 消除双轨抽象）
    const moduLlm = wrap_chat_model_as_modu(chatModel, provider)
    logger.info(
      'Built LLM-as-Judge evaluator (ModuLLM): provider=%s temp=%.2f max_tokens=%d',
      provider, temperature, maxTokens,
    )
    return moduLlm
  } catch (e: any) {
    logger.warning(
      'Failed to build judge LLM (provider=%s), QualityMonitor will fall back to rule: %s',
      provider, String(e),
    )
    return null
  }
}

/**
 * 构造主流程 LLM 的 ModuLLM 视图（对应文档 §2.1 统一 LLM 接口）。
 *
 * 主流程图节点仍消费 LangChain Runnable 接口（bind/invoke），
 * 此函数提供同一 ChatOpenAI 实例的 ModuLLM 包装视图，供：
 *   - LLMRouter 路由表工厂使用
 *   - 外部消费者（如 CostDashboard / 调试工具）面向 ModuLLM 编程
 *   - 未来逐步迁移 graph 节点至 ModuLLM 接口
 *
 * 注意：返回的 ModuLLM 与主流程 boundLlm 共享底层 ChatOpenAI 实例，
 *       不会产生额外连接池或重复成本核算（成本核算在 invoke 内一次性发布）。
 *
 * @param chatModel LangChain ChatOpenAI 实例
 * @param provider  Provider 标识
 * @returns ModuLLM 包装实例
 */
export function _build_modu_llm(
  chatModel: any,
  provider: string,
): ModuLLM {
  return wrap_chat_model_as_modu(chatModel, provider)
}

/**
 * 构造 LLMRouter（对应文档 §2.1 模型路由层建议）。
 *
 * 当 `llm.router.enabled=true` 时，根据配置构造 RuleBasedLLMRouter：
 *   - 读取 llm.router.routes 配置，为每个命名路由构造 ModuLLM 实例
 *   - 读取 llm.router.rules 配置，按顺序匹配 RouteRule
 *   - 无规则命中时走 default_route
 *
 * 当 `llm.router.enabled=false`（默认）时，返回 PassthroughLLMRouter，
 * 包装主流程 LLM，保持接口一致性但不做实际路由。
 *
 * @param mainLlm    主流程 ModuLLM 实例（PassthroughLLMRouter 使用）
 * @param runtimeConfig 运行时配置
 * @returns LLMRouter 实例
 */
export function _build_llm_router(
  mainLlm: ModuLLM,
  runtimeConfig: RuntimeConfig,
): LLMRouter {
  if (!runtimeConfig.get('llm.router.enabled', false)) {
    return new PassthroughLLMRouter(mainLlm)
  }

  const routesConfig = runtimeConfig.get('llm.router.routes', {}) as Record<string, any>
  const defaultRoute = runtimeConfig.get('llm.router.default_route', 'default')

  // 构造路由表：路由名 → ModuLLM 工厂
  const routeTable: RouteTable = {}
  for (const [routeName, routeCfg] of Object.entries(routesConfig)) {
    const provider = routeCfg?.provider ?? runtimeConfig.get('llm.default_provider', 'deepseek')
    const model = routeCfg?.model ?? ''
    const temperature = routeCfg?.temperature
    const maxTokens = routeCfg?.max_tokens
    routeTable[routeName] = () => {
      const chatModel = build_chat_model(provider, runtimeConfig, temperature, maxTokens, model)
      return wrap_chat_model_as_modu(chatModel, provider)
    }
  }

  // 兜底：若 default_route 不在 routes 配置中，使用 mainLlm
  if (!routeTable[defaultRoute]) {
    logger.warning(
      "llm.router.default_route '%s' not in routes config, using main LLM as default",
      defaultRoute,
    )
    routeTable[defaultRoute] = () => mainLlm
  }

  try {
    const router = new RuleBasedLLMRouter(routeTable, undefined, defaultRoute)
    logger.info(
      'LLMRouter enabled: routes=%s default=%s',
      Object.keys(routeTable).join(','),
      defaultRoute,
    )
    return router
  } catch (e: any) {
    logger.warning(
      'Failed to build RuleBasedLLMRouter, falling back to Passthrough: %s',
      String(e),
    )
    return new PassthroughLLMRouter(mainLlm)
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
  // P0-优化: 默认注册无风险内置工具（DateTimeTool/SearchTool/CalculatorTool），
  // 使防幻觉 system prompt 中引用的工具实际可用。受 tools.register_defaults 配置控制，
  // 宿主可设为 false 关闭。注册幂等，已存在则跳过。
  // HttpRequestTool/FileOpsTool/SqlQueryTool/CodeExecutionTool 因需审批或需配置，
  // 不默认注册，由宿主按需注册。
  if (runtimeConfig.get('tools.register_defaults', true)) {
    const registry = getRegistry()
    const defaults = [
      { name: 'datetime', ctor: () => new DateTimeTool() },
      { name: 'search_engine', ctor: () => new SearchTool() },
      { name: 'calculator', ctor: () => new CalculatorTool() },
      { name: 'doc_writer', ctor: () => new DocWriterTool() },
    ]
    for (const t of defaults) {
      if (registry.getTool(t.name) === undefined) {
        try {
          registry.registerTool(t.ctor())
        } catch (e: any) {
          logger.warning("Failed to register default tool '%s': %s", t.name, String(e))
        }
      }
    }
  }

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

  // 系统提示词（P0-优化: 宿主未传入时使用默认防幻觉 prompt 作为底线约束）
  let effectiveSystemPrompt =
    configurable['system_prompt'] ?? systemPrompt ?? _DEFAULT_ANTI_HALLUCINATION_PROMPT

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

  // P1: Markdown 文档提示注入（gated by react_optimization.markdown_prompt.enabled，默认关闭）
  // 启用后在项目根目录扫描 AGENTS.md/SOUL.md/USER.md/MEMORY.md：
  //   - inject_to=system_prompt 的文档（AGENTS/SOUL）并入 system prompt；
  //   - inject_to=runtime_context 的文档（USER/MEMORY）作为 runtimeContext，
  //     供后续 PromptComposer 的 runtimeContext 层使用。
  // 无任何 .md 文件时行为与关闭完全一致（等价现状，零侵入）。
  // runtimeContext 优先级：宿主显式传入 configurable['runtime_context'] > Markdown 文档。
  let markdownRuntimeContext = configurable['runtime_context'] ?? null
  if (runtimeConfig.get('react_optimization.markdown_prompt.enabled', false)) {
    try {
      // 4.5 风险① Token 膨胀：eager 文档常驻注入；lazy 文档（如 MEMORY.md）按需加载，
      // 此处仅加载 eager，lazy 文档由宿主按需显式加载（loadMarkdownDocs({ onlyLoad: 'lazy' })）。
      const mdDocs = loadMarkdownDocs({ onlyLoad: 'eager' })
      // 4.5 风险①：按配置的长度预算截断注入内容
      const budget: MarkdownBudget = {
        systemPromptMaxChars: runtimeConfig.get('react_optimization.markdown_prompt.system_prompt_max_chars', 8000),
        runtimeContextMaxChars: runtimeConfig.get('react_optimization.markdown_prompt.runtime_context_max_chars', 4000),
        truncateMarker: '\n\n[truncated]',
      }
      const aggregated = MarkdownPromptAggregator.aggregateFromDocs(effectiveSystemPrompt, mdDocs, budget)
      effectiveSystemPrompt = aggregated.systemPrompt ?? effectiveSystemPrompt
      if (configurable['runtime_context'] === undefined || configurable['runtime_context'] === null) {
        const rc = aggregated.runtimeContext
        markdownRuntimeContext = rc !== '' ? rc : null
      }
      logger.info('[P1] Markdown prompt injected: docs=%s systemP=%s runtimeCtx=%s',
        mdDocs.length > 0 ? mdDocs.map((d) => d.name).join(',') : '(none)',
        aggregated.systemPrompt !== effectiveSystemPrompt ? 'updated' : '(none)',
        markdownRuntimeContext ? '(set)' : '(none)',
      )
    } catch (e: any) {
      logger.warning('[P1] Markdown prompt injection failed, using base prompt: %s', String(e))
    }
  }

  // P1-4: 四层 Prompt 解耦架构（gated by react_optimization.prompt_composer.enabled）
  // 启用后通过 PromptComposer 组装 systemCore + domain + taskSpec + runtimeContext
  // domain 为空时行为与现状完全一致（字符等价回归，对应 R-08 策略①）
  if (runtimeConfig.get('react_optimization.prompt_composer.enabled', false)) {
    try {
      effectiveSystemPrompt = PromptComposer.compose({
        systemCore: effectiveSystemPrompt ?? '',
        domain: configurable['domain'] ?? null,
        taskSpec: configurable['task_spec'] ?? null,
        runtimeContext: markdownRuntimeContext,
      })
      logger.info('[P1-4] PromptComposer enabled: domain=%s taskSpec=%s runtimeContext=%s',
        configurable['domain'] ?? '(none)',
        configurable['task_spec'] ? '(set)' : '(none)',
        markdownRuntimeContext ? '(set)' : '(none)',
      )
    } catch (e: any) {
      logger.warning('[P1-4] PromptComposer failed, using aggregated prompt: %s', String(e))
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

  // P0-1: 构造复杂度评估器
  // gated by react_optimization.complexity_assessment.enabled（默认 false，零风险）
  // 启用时复用主流程 LLM 的 ModuLLM 视图，避免额外连接池
  let complexityAssessor: ComplexityAssessor | null = null
  const enableComplexityAssessment = runtimeConfig.get(
    'react_optimization.complexity_assessment.enabled', false,
  )
  if (enableComplexityAssessment) {
    try {
      const moduLlmForAssessment = _build_modu_llm(llm, provider ?? runtimeConfig.get('llm.default_provider', 'glm'))
      complexityAssessor = new ComplexityAssessor(moduLlmForAssessment)
      logger.info('[P0-1] ComplexityAssessor enabled')
    } catch (e: any) {
      logger.warning('[P0-1] ComplexityAssessor init failed, using null (rule fallback only): %s', String(e))
      // 即使 ModuLLM 包装失败，也构造一个无 LLM 的 assessor（纯规则化评估）
      complexityAssessor = new ComplexityAssessor(null)
    }
  }

  // P0-3: 构造 Observation 蒸馏器
  // 默认启用（与 makeToolResultProcessor 内的 feature flag 默认 true 一致）
  // max_tokens 可通过 react_optimization.observation_distillation.max_tokens 配置
  let observationDistiller: ObservationDistiller | null = null
  try {
    const enableDistillation = runtimeConfig.get(
      'react_optimization.observation_distillation.enabled', true,
    )
    if (enableDistillation) {
      const maxTokens = runtimeConfig.get(
        'react_optimization.observation_distillation.max_tokens', 500,
      )
      observationDistiller = new ObservationDistiller(maxTokens)
      logger.info('[P0-3] ObservationDistiller enabled (max_tokens=%d)', maxTokens)
    }
  } catch (e: any) {
    logger.warning('[P0-3] ObservationDistiller init failed, using null: %s', String(e))
  }

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
    complexityAssessor,  // P0-1: 复杂度评估器
    observationDistiller, // P0-3: Observation 蒸馏器
  )
  logger.info(
    'create_agent plan_execute: configurable=%j plan_execute_enabled=%s',
    configurable,
    configurable['plan_execute_enabled'] ?? null,
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
