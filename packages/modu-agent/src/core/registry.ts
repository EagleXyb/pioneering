// 对应 Python: core/registry.py
// ComponentRegistry 单例：管理 11 类组件，支持 swap_component 热替换
import type { BaseActionExecutor, BaseTool } from './interfaces/action.js'
import type { BaseEvolutionSignal, BaseFeedbackLoop } from './interfaces/feedback.js'
import type { BaseMemory, BaseStorageAdapter } from './interfaces/memory.js'
import type { BasePerception, BaseSensor } from './interfaces/perception.js'
import type { BaseReasoningEngine, BaseReasoningStrategy } from './interfaces/reasoning.js'
import type { BaseSkill } from './interfaces/skill.js'
// P1（T-12）：LLM provider 注册表（底座"横向可替换"扩展点）
import type { LLMProviderFactory } from './interfaces/llm-provider.js'
// P1（T-11）：记忆策略统一契约注册表（底座"横向可替换"扩展点）
import type { MemoryStrategy } from './interfaces/memory-strategy.js'
// P1（T-10）：统一策略引擎（permission 底座）
import type { PolicyEngine, PolicyRule } from './interfaces/policy.js'
import { DefaultPolicyEngine } from './policy-engine.js'
// P2（T-14）：Prompt 注册表（底座"提示词可注册"扩展点）
// 依赖方向：core → reasoning（单向；reasoning/prompt-registry.ts 不 import core/registry.ts，
// 仅 import core/interfaces/prompt.js 的类型 → 运行时无循环）。
import type { PromptTemplate } from './interfaces/prompt.js'
import { getPromptRegistry, resetPromptRegistry } from '../reasoning/prompt-registry.js'
// P2（T-15）：上下文策略（底座"上下文可注册"扩展点）
import type { ContextStrategy } from './interfaces/context.js'
// P2（T-13）：图拓扑扩展点（`import type` → 运行时无环，见 graph/spec.ts 文件头说明）
// P3（T-20）：扩展子图声明同源
import type { EdgeSpec, NodeSpec, SubgraphSpec } from '../graph/spec.js'
// P0（T-06）：工具能力矩阵随注册自动同步
import { ensureToolCapability } from '../tools/tool-registry.js'

// 创建一个兼容 console 的 logger，避免硬依赖具体日志库
const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[registry] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[registry] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[registry] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[registry] ${msg}`, ...args),
}

// P1: SkillToolWrapper 工厂注入点。
// 对应 Python register_skill 中 `from skills.adapter import SkillToolWrapper` 的延迟导入。
// skills 模块加载时通过 setSkillToolWrapperFactory 注册，避免 ESM 循环依赖。
// 未注册时退化为直接使用原始工具（与 Python except 分支等价）。
type SkillToolWrapperFactory = (tool: BaseTool, skillName: string) => BaseTool
let _skillToolWrapperFactory: SkillToolWrapperFactory | null = null

/**
 * 注入 SkillToolWrapper 工厂（由 skills/adapter 模块在加载时调用）。
 */
export function setSkillToolWrapperFactory(factory: SkillToolWrapperFactory): void {
  _skillToolWrapperFactory = factory
}

/**
 * 组件注册中心。
 *
 * 管理 11 类组件（reasoning_engine / reasoning_strategy / action_executor / tool /
 * memory / storage_adapter / perception / sensor / feedback_loop / evolution_signal / skill）。
 *
 * 对应 Python ComponentRegistry：
 *   - 首个注册的推理引擎自动成为活跃引擎
 *   - register_skill 会自动把 Skill 内含工具注册进 _tools
 *   - swap_component 支持运行时热替换（供进化策略使用）
 */
export class ComponentRegistry {
  private _reasoningEngines: Map<string, BaseReasoningEngine> = new Map()
  // P2-8: 显式追踪活跃推理引擎名称，避免依赖 Map 插入顺序导致多引擎时选择不确定
  private _activeReasoningEngineName: string | null = null
  private _reasoningStrategies: Map<string, BaseReasoningStrategy> = new Map()
  private _actionExecutors: Map<string, BaseActionExecutor> = new Map()
  private _tools: Map<string, BaseTool> = new Map()
  private _memories: Map<string, BaseMemory> = new Map()
  private _storageAdapters: Map<string, BaseStorageAdapter> = new Map()
  private _perceptions: Map<string, BasePerception> = new Map()
  private _sensors: Map<string, BaseSensor> = new Map()
  private _feedbackLoops: Map<string, BaseFeedbackLoop> = new Map()
  private _evolutionSignals: Map<string, BaseEvolutionSignal> = new Map()
  // P1: Skills 扩展（可插拔单元，内部工具注册进 _tools）
  private _skills: Map<string, BaseSkill> = new Map()
  // P1（T-12）：LLM provider 工厂（provider 标识 → 工厂）。
  // 独立于既有 11 类组件，不计入 listAll()/swapComponent() 的既有契约（避免破坏既有断言）。
  private _llmProviders: Map<string, LLMProviderFactory> = new Map()
  // P1（T-11）：记忆策略（策略 id → 策略）。同样独立于既有 11 类组件。
  private _memoryStrategies: Map<string, MemoryStrategy> = new Map()
  private _defaultMemoryStrategyId: string | null = null
  // P1（T-10）：统一策略引擎（规则注册 + 懒构造引擎）。独立于既有 11 类组件。
  private _policyRules: Map<string, PolicyRule> = new Map()
  private _policyEngine: PolicyEngine | null = null
  // P2（T-15）：上下文策略（策略 id → 策略）。独立于既有 11 类组件。
  // 注：Prompt 注册表（T-14）无需本地状态 —— `registerPrompt/getPrompt/...`
  //     直接委托全局单例 `getPromptRegistry()`（见文件头依赖说明）。
  private _contextStrategies: Map<string, ContextStrategy> = new Map()
  private _defaultContextStrategyId: string | null = null
  // P2（T-13）：图拓扑扩展声明（节点/边）。默认空 → 默认图行为零变化。
  private _nodeSpecs: NodeSpec[] = []
  private _edgeSpecs: EdgeSpec[] = []
  // P3（T-20）：图拓扑扩展子图声明。默认空 → 默认图行为零变化。
  private _subgraphs: SubgraphSpec[] = []

  registerReasoningEngine(name: string, engine: BaseReasoningEngine): void {
    if (!(engine instanceof Object)) {
      throw new TypeError(`engine must be a BaseReasoningEngine, got ${typeof engine}`)
    }
    this._reasoningEngines.set(name, engine)
    // P2-8: 首个注册的引擎自动成为活跃引擎
    if (this._activeReasoningEngineName === null) {
      this._activeReasoningEngineName = name
    }
    logger.info('Registered reasoning engine: %s', name)
  }

  /** P2-8: 显式设置活跃推理引擎。 */
  setActiveReasoningEngine(name: string): void {
    if (!this._reasoningEngines.has(name)) {
      throw new Error(`reasoning engine '${name}' not registered`)
    }
    this._activeReasoningEngineName = name
    logger.info('Set active reasoning engine: %s', name)
  }

  getReasoningEngine(name: string): BaseReasoningEngine | undefined {
    return this._reasoningEngines.get(name)
  }

  /** P2-8: 返回活跃推理引擎。优先返回显式指定的引擎，否则回退首个注册引擎。 */
  getActiveReasoningEngine(): BaseReasoningEngine | null {
    if (this._reasoningEngines.size === 0) {
      return null
    }
    const activeName = this._activeReasoningEngineName
    if (activeName && this._reasoningEngines.has(activeName)) {
      return this._reasoningEngines.get(activeName)!
    }
    // 回退：返回首个注册引擎
    return this._reasoningEngines.values().next().value ?? null
  }

  registerReasoningStrategy(name: string, strategy: BaseReasoningStrategy): void {
    this._reasoningStrategies.set(name, strategy)
    logger.info('Registered reasoning strategy: %s', name)
  }

  getReasoningStrategy(name: string): BaseReasoningStrategy | undefined {
    return this._reasoningStrategies.get(name)
  }

  registerActionExecutor(name: string, executor: BaseActionExecutor): void {
    this._actionExecutors.set(name, executor)
    logger.info('Registered action executor: %s', name)
  }

  getActionExecutor(name: string): BaseActionExecutor | undefined {
    return this._actionExecutors.get(name)
  }

  registerTool(tool: BaseTool): void {
    const toolName = tool.name()
    this._tools.set(toolName, tool)
    // P0（T-06）：能力矩阵随注册自动同步。
    // 为未登记工具（MCP / Skill / 宿主自定义）派生保守能力条目，
    // 使第三方工具不再是"能力未知"；已登记条目（内置 7 项 + 显式注册）不被覆盖。
    // 失败不影响注册主流程。
    try {
      if (ensureToolCapability(toolName)) {
        logger.debug("Auto-derived conservative capability for tool '%s'", toolName)
      }
    } catch (e: any) {
      logger.warning("Failed to auto-derive capability for tool '%s': %s", toolName, String(e))
    }
    logger.info('Registered tool: %s', toolName)
  }

  getTool(name: string): BaseTool | undefined {
    return this._tools.get(name)
  }

  listTools(): Record<string, Record<string, any>> {
    const result: Record<string, Record<string, any>> = {}
    for (const [name, tool] of this._tools) {
      result[name] = {
        name: tool.name(),
        description: tool.description(),
        parameters_schema: tool.parametersSchema(),
      }
    }
    return result
  }

  registerMemory(name: string, memory: BaseMemory): void {
    this._memories.set(name, memory)
    logger.info('Registered memory: %s', name)
  }

  getMemory(name: string): BaseMemory | undefined {
    return this._memories.get(name)
  }

  registerStorageAdapter(name: string, adapter: BaseStorageAdapter): void {
    this._storageAdapters.set(name, adapter)
    logger.info('Registered storage adapter: %s', name)
  }

  getStorageAdapter(name: string): BaseStorageAdapter | undefined {
    return this._storageAdapters.get(name)
  }

  registerPerception(name: string, perception: BasePerception): void {
    this._perceptions.set(name, perception)
    logger.info('Registered perception: %s', name)
  }

  getPerception(name: string): BasePerception | undefined {
    return this._perceptions.get(name)
  }

  registerSensor(name: string, sensor: BaseSensor): void {
    this._sensors.set(name, sensor)
    logger.info('Registered sensor: %s', name)
  }

  getSensor(name: string): BaseSensor | undefined {
    return this._sensors.get(name)
  }

  registerFeedbackLoop(name: string, loop: BaseFeedbackLoop): void {
    this._feedbackLoops.set(name, loop)
    logger.info('Registered feedback loop: %s', name)
  }

  getFeedbackLoop(name: string): BaseFeedbackLoop | undefined {
    return this._feedbackLoops.get(name)
  }

  registerEvolutionSignal(name: string, signal: BaseEvolutionSignal): void {
    this._evolutionSignals.set(name, signal)
    logger.info('Registered evolution signal: %s', name)
  }

  getEvolutionSignal(name: string): BaseEvolutionSignal | undefined {
    return this._evolutionSignals.get(name)
  }

  // ------------------------------------------------------------------
  // P1（T-12）：LLM provider 注册表
  // ------------------------------------------------------------------

  /**
   * 注册 LLM provider 工厂（新增可选扩展，不改既有方法签名）。
   *
   * 冲突策略：同 id 覆盖（宿主显式注册即视为权威）。
   * 内置 provider 由 `graph/adapters/llm-adapter.ts` 的
   * `registerBuiltinLLMProviders()` 幂等注册，故宿主覆盖不会被回退覆盖。
   */
  registerLLMProvider(factory: LLMProviderFactory): void {
    if (!factory || !factory.id) {
      throw new TypeError('LLMProviderFactory.id must be non-empty')
    }
    this._llmProviders.set(factory.id, factory)
    logger.info('Registered LLM provider: %s', factory.id)
  }

  getLLMProvider(provider: string): LLMProviderFactory | undefined {
    return this._llmProviders.get(provider)
  }

  /** 返回已注册 provider id 列表（不含默认值，用于调试与验收）。 */
  listLLMProviders(): string[] {
    return [...this._llmProviders.keys()]
  }

  // ------------------------------------------------------------------
  // P1（T-11）：记忆策略注册表（统一 MemoryStrategy 契约）
  // ------------------------------------------------------------------

  /**
   * 注册记忆策略（新增可选扩展，不改既有 `registerMemory` / `getMemory` 签名）。
   *
   * 与既有 `registerMemory`（`BaseMemory` 家族）的关系：
   *   - `registerMemory` 保留为**兼容旁路**（P0 T-06 的注册目标），不作为主链路验收依据；
   *   - `registerMemoryStrategy` 是主链路（`memory_query` / `memory_update`）的策略入口。
   *
   * @param strategy     策略实例
   * @param opts.makeDefault 是否设为默认策略（无任务级命中时回退到它）
   */
  registerMemoryStrategy(strategy: MemoryStrategy, opts: { makeDefault?: boolean } = {}): void {
    if (!strategy || !strategy.id) {
      throw new TypeError('MemoryStrategy.id must be non-empty')
    }
    this._memoryStrategies.set(strategy.id, strategy)
    if (opts.makeDefault === true || this._defaultMemoryStrategyId === null) {
      this._defaultMemoryStrategyId = strategy.id
    }
    logger.info('Registered memory strategy: %s', strategy.id)
  }

  getMemoryStrategy(id: string): MemoryStrategy | undefined {
    return this._memoryStrategies.get(id)
  }

  /** 返回已注册策略 id 列表。 */
  listMemoryStrategies(): string[] {
    return [...this._memoryStrategies.keys()]
  }

  /**
   * 设置默认记忆策略（无任务级命中时的回退目标）。
   */
  setDefaultMemoryStrategy(id: string): void {
    if (!this._memoryStrategies.has(id)) {
      throw new Error(`memory strategy '${id}' not registered`)
    }
    this._defaultMemoryStrategyId = id
    logger.info('Set default memory strategy: %s', id)
  }

  /** 当前默认记忆策略 id（未设置/已被移除时为 null）。 */
  getDefaultMemoryStrategyId(): string | null {
    return this._defaultMemoryStrategyId
  }

  /**
   * 解析记忆策略（P1 T-11 契约 §4.1.2）。
   *
   * 顺序：
   *   1. `taskType` 非空 → 首个 `supports(taskType) === true` 的策略；
   *   2. 注册时标记的默认策略（`makeDefault` / `setDefaultMemoryStrategy`）；
   *   3. 无命中 → `undefined`（调用方回退到既有直连实现，保证默认行为零变化）。
   */
  resolveMemoryStrategy(taskType?: string): MemoryStrategy | undefined {
    if (taskType !== undefined && taskType !== null && taskType !== '') {
      for (const strategy of this._memoryStrategies.values()) {
        try {
          if (strategy.supports(taskType)) return strategy
        } catch (e: any) {
          logger.warning('memory strategy %s supports() failed: %s', strategy.id, String(e))
        }
      }
    }
    if (this._defaultMemoryStrategyId !== null) {
      const fallback = this._memoryStrategies.get(this._defaultMemoryStrategyId)
      if (fallback !== undefined) return fallback
    }
    return undefined
  }

  // ------------------------------------------------------------------
  // P1（T-10）：统一策略引擎（权限底座）
  // ------------------------------------------------------------------

  /**
   * 注册策略规则（新增可选扩展，不改既有方法签名）。
   *
   * 引擎懒构造：首次 `getPolicyEngine()` 时创建，并把已注册规则灌入，
   * 因此"先注册规则、后取引擎"与"先取引擎、后注册规则"两种顺序均正确。
   */
  registerPolicyRule(rule: PolicyRule): void {
    if (!rule || !rule.id) {
      throw new TypeError('PolicyRule.id must be non-empty')
    }
    this._policyRules.set(rule.id, rule)
    if (this._policyEngine !== null) {
      this._policyEngine.use(rule)
    }
    logger.info('Registered policy rule: %s (stage=%s)', rule.id, rule.stage)
  }

  /** 返回统一策略引擎（懒构造；无规则时恒返回 allow，等价现状）。 */
  getPolicyEngine(): PolicyEngine {
    if (this._policyEngine === null) {
      const engine = new DefaultPolicyEngine()
      for (const rule of this._policyRules.values()) {
        engine.use(rule)
      }
      this._policyEngine = engine
    }
    return this._policyEngine
  }

  /** 设置/替换策略引擎（供装配层注入自定义实现）。已注册规则会被重新灌入。 */
  setPolicyEngine(engine: PolicyEngine): void {
    for (const rule of this._policyRules.values()) {
      engine.use(rule)
    }
    this._policyEngine = engine
    logger.info('Policy engine replaced: %d rule(s) reapplied', this._policyRules.size)
  }

  /** 返回已注册策略规则 id 列表（可按阶段过滤）。 */
  listPolicyRules(stage?: 'input' | 'tool' | 'output'): string[] {
    return [...this._policyRules.values()]
      .filter((r) => (stage ? r.stage === stage : true))
      .map((r) => r.id)
  }

  // ------------------------------------------------------------------
  // P2（T-14）：Prompt 注册表（提示词可注册）
  // ------------------------------------------------------------------

  /**
   * 注册 Prompt 模板（新增可选扩展，不改既有方法签名）。
   *
   * 直接委托 `reasoning/prompt-registry.ts` 的全局单例 —— 该单例是
   * `graph/prompt-templates.ts`（内置模板）与宿主自定义模板的**唯一存储**，
   * 因此宿主经本方法注册即等价于直接调用 `registerPrompt`。
   *
   * 冲突策略：同 id 覆盖（宿主显式注册即视为权威）。
   */
  registerPrompt(template: PromptTemplate): void {
    getPromptRegistry().register(template)
  }

  getPrompt(id: string): PromptTemplate | undefined {
    return getPromptRegistry().get(id)
  }

  /** 列出已注册模板（可按 taskType 过滤）。 */
  listPrompts(taskType?: string): PromptTemplate[] {
    return getPromptRegistry().list(taskType)
  }

  /** 渲染模板（未知 id 返回空串，调用方据此回退内置字面量）。 */
  renderPrompt(id: string, vars: Record<string, unknown> = {}): string {
    return getPromptRegistry().render(id, vars)
  }

  // ------------------------------------------------------------------
  // P2（T-15）：上下文策略注册表（上下文可注册）
  // ------------------------------------------------------------------

  /**
   * 注册上下文策略（新增可选扩展，不改既有方法签名）。
   *
   * @param strategy          策略实例（其 `fragments()` 决定注入片段的顺序与预算）
   * @param opts.makeDefault  是否设为默认策略（无任务级命中时回退到它）
   */
  registerContextStrategy(strategy: ContextStrategy, opts: { makeDefault?: boolean } = {}): void {
    if (!strategy || !strategy.id) {
      throw new TypeError('ContextStrategy.id must be non-empty')
    }
    this._contextStrategies.set(strategy.id, strategy)
    if (opts.makeDefault === true || this._defaultContextStrategyId === null) {
      this._defaultContextStrategyId = strategy.id
    }
    logger.info('Registered context strategy: %s', strategy.id)
  }

  getContextStrategy(id: string): ContextStrategy | undefined {
    return this._contextStrategies.get(id)
  }

  /** 返回已注册上下文策略 id 列表。 */
  listContextStrategies(): string[] {
    return [...this._contextStrategies.keys()]
  }

  /** 设置默认上下文策略（无任务级命中时的回退目标）。 */
  setDefaultContextStrategy(id: string): void {
    if (!this._contextStrategies.has(id)) {
      throw new Error(`context strategy '${id}' not registered`)
    }
    this._defaultContextStrategyId = id
    logger.info('Set default context strategy: %s', id)
  }

  /** 当前默认上下文策略 id（未设置时为 null）。 */
  getDefaultContextStrategyId(): string | null {
    return this._defaultContextStrategyId
  }

  /**
   * 解析上下文策略（P2 T-15 契约）。
   *
   * 顺序（与 `resolveMemoryStrategy` 同构）：
   *   1. `taskType` 非空 → 首个 `supports(taskType) === true` 的策略；
   *   2. 注册时标记的默认策略；
   *   3. 无命中 → `undefined`（调用方回退内置默认策略，保证默认行为零变化）。
   */
  resolveContextStrategy(taskType?: string): ContextStrategy | undefined {
    if (taskType !== undefined && taskType !== null && taskType !== '') {
      for (const strategy of this._contextStrategies.values()) {
        try {
          if (strategy.supports(taskType)) return strategy
        } catch (e: any) {
          logger.warning('context strategy %s supports() failed: %s', strategy.id, String(e))
        }
      }
    }
    if (this._defaultContextStrategyId !== null) {
      const fallback = this._contextStrategies.get(this._defaultContextStrategyId)
      if (fallback !== undefined) return fallback
    }
    return undefined
  }

  // ------------------------------------------------------------------
  // P2（T-13）：图拓扑扩展点（节点/边声明）
  // ------------------------------------------------------------------

  /**
   * 注册图节点声明（新增可选扩展，不改既有方法签名）。
   *
   * 语义：`buildFromSpec` 在**默认拓扑声明之后**追加宿主声明的节点/边，
   * 因而宿主可"新增 1 个图节点而**不改 `graph/graph.ts`**"（M3 验收口径）。
   *
   * 约束：
   *   - 与内置节点同名时以**内置为准**（扩展声明被忽略并告警）；
   *   - 默认路径（零注册）图结构与行为零变化；
   *   - 受 `graph.spec.extensions_enabled`（默认 true）门控。
   */
  registerNode(spec: NodeSpec): void {
    if (!spec || !spec.name || typeof spec.factory !== 'function') {
      throw new TypeError('NodeSpec.name must be non-empty and factory must be a function')
    }
    if (this._nodeSpecs.some((s) => s.name === spec.name)) {
      throw new Error(`node spec '${spec.name}' already registered`)
    }
    this._nodeSpecs.push(spec)
    logger.info('Registered node spec: %s', spec.name)
  }

  /** 注册图边声明（追加在默认边之后）。 */
  registerEdge(spec: EdgeSpec): void {
    if (!spec || !spec.from || spec.to === undefined || spec.to === null) {
      throw new TypeError('EdgeSpec.from / EdgeSpec.to must be non-empty')
    }
    this._edgeSpecs.push(spec)
    logger.info('Registered edge spec: %s→%s', spec.from, typeof spec.to === 'string' ? spec.to : '(conditional)')
  }

  /** 返回已注册的节点声明（供 `buildFromSpec` 消费）。 */
  listNodeSpecs(): NodeSpec[] {
    return [...this._nodeSpecs]
  }

  /** 返回已注册的边声明（供 `buildFromSpec` 消费）。 */
  listEdgeSpecs(): EdgeSpec[] {
    return [...this._edgeSpecs]
  }

  /**
   * 注册扩展子图声明（P3/T-20：闭环 `GraphSpec.subgraphs` 的注册通路）。
   *
   * 语义：`buildFromSpec` 把 `builder(deps)` 的产物作为**真子图节点**挂到 `parentNode`；
   * `parentNode` 与已启用节点同名时以**内置/声明节点为准**（子图被忽略并告警）。
   * 默认路径（零注册）图结构与行为零变化；受 `graph.spec.enabled` 门控。
   */
  registerSubgraph(spec: SubgraphSpec): void {
    if (!spec || !spec.name || !spec.parentNode || typeof spec.builder !== 'function') {
      throw new TypeError('SubgraphSpec.name / parentNode must be non-empty and builder must be a function')
    }
    if (this._subgraphs.some((s) => s.name === spec.name)) {
      throw new Error(`subgraph spec '${spec.name}' already registered`)
    }
    this._subgraphs.push(spec)
    logger.info('Registered subgraph spec: %s (mount node=%s)', spec.name, spec.parentNode)
  }

  /** 返回已注册的子图声明（供 `buildFromSpec` 消费）。 */
  listSubgraphs(): SubgraphSpec[] {
    return [...this._subgraphs]
  }

  // P3-D：默认边的受控裁剪登记
  private _edgeRemovals: Array<{ from: string; to?: string }> = []

  /**
   * 登记移除默认/已注册边（P3-D：受控覆盖）。
   *
   * 匹配规则：`from` 相等 且（`to` 省略=该 from 的全部边；否则目标字符串相等，
   * 条件边以 '(conditional)' 命中）。重复登记幂等。
   */
  registerEdgeRemoval(removal: { from: string; to?: string }): void {
    if (!removal?.from) throw new TypeError('edge removal.from must be non-empty')
    const dup = this._edgeRemovals.some(
      (r) => r.from === removal.from && r.to === removal.to,
    )
    if (!dup) this._edgeRemovals.push({ from: removal.from, to: removal.to })
  }

  /** 撤销一条边移除登记；不存在返回 false。 */
  unregisterEdgeRemoval(removal: { from: string; to?: string }): boolean {
    const before = this._edgeRemovals.length
    this._edgeRemovals = this._edgeRemovals.filter(
      (r) => !(r.from === removal.from && r.to === removal.to),
    )
    return this._edgeRemovals.length < before
  }

  /** 列出边移除登记（供 buildFromSpec 消费）。 */
  listEdgeRemovals(): Array<{ from: string; to?: string }> {
    return [...this._edgeRemovals]
  }

  /** 清空图拓扑扩展声明与边移除登记（测试清理/热替换用）。 */
  clearGraphSpecs(): void {
    this._nodeSpecs = []
    this._edgeSpecs = []
    this._subgraphs = []
    this._edgeRemovals = []
  }

  // ------------------------------------------------------------------
  // P3-B：卸载/移除原语（供 kernel ScenarioHost 做作用域回滚）
  // ------------------------------------------------------------------

  /** 移除已注册工具；不存在返回 false。 */
  unregisterTool(name: string): boolean {
    const existed = this._tools.delete(name)
    if (existed) logger.info('Unregistered tool: %s', name)
    return existed
  }

  /** 移除已注册 LLM provider；不存在返回 false。 */
  unregisterLLMProvider(id: string): boolean {
    const existed = this._llmProviders.delete(id)
    if (existed) logger.info('Unregistered LLM provider: %s', id)
    return existed
  }

  /** 移除记忆策略；若被移除者是默认策略则默认回到剩余首个策略（无则 null）。 */
  unregisterMemoryStrategy(id: string): boolean {
    const existed = this._memoryStrategies.delete(id)
    if (!existed) return false
    if (this._defaultMemoryStrategyId === id) {
      this._defaultMemoryStrategyId = this._memoryStrategies.values().next().value?.id ?? null
    }
    logger.info('Unregistered memory strategy: %s', id)
    return true
  }

  /** 移除策略规则；已构造引擎同步摘除（P0-1：契约化 remove，不再 as any 探测）。 */
  unregisterPolicyRule(id: string): boolean {
    const existed = this._policyRules.delete(id)
    if (!existed) return false
    // 引擎一旦懒构造，规则副本已灌入引擎，必须同步摘除，否则卸载后仍命中。
    this._policyEngine?.remove(id)
    logger.info('Unregistered policy rule: %s', id)
    return true
  }

  /** 移除上下文策略；默认策略处理同记忆策略。 */
  unregisterContextStrategy(id: string): boolean {
    const existed = this._contextStrategies.delete(id)
    if (!existed) return false
    if (this._defaultContextStrategyId === id) {
      this._defaultContextStrategyId = this._contextStrategies.values().next().value?.id ?? null
    }
    logger.info('Unregistered context strategy: %s', id)
    return true
  }

  /** 按名移除已注册节点声明；不存在返回 false。 */
  removeNodeSpec(name: string): boolean {
    const before = this._nodeSpecs.length
    this._nodeSpecs = this._nodeSpecs.filter((s) => s.name !== name)
    const removed = this._nodeSpecs.length < before
    if (removed) logger.info('Removed node spec: %s', name)
    return removed
  }

  /** 按名移除已注册子图声明；不存在返回 false。 */
  removeSubgraph(name: string): boolean {
    const before = this._subgraphs.length
    this._subgraphs = this._subgraphs.filter((s) => s.name !== name)
    const removed = this._subgraphs.length < before
    if (removed) logger.info('Removed subgraph spec: %s', name)
    return removed
  }

  /**
   * 移除已注册边声明。
   * 匹配规则：`from` 相等 且（`to` 省略或目标相等；条件边以 `to='(conditional)'` 命中）。
   */
  removeEdgeSpec(from: string, to?: string): boolean {
    const before = this._edgeSpecs.length
    this._edgeSpecs = this._edgeSpecs.filter((e) => {
      if (e.from !== from) return true
      if (to === undefined) return false
      const target = typeof e.to === 'string' ? e.to : '(conditional)'
      return target !== to
    })
    const removed = this._edgeSpecs.length < before
    if (removed) logger.info('Removed edge spec: %s→%s', from, to ?? '*')
    return removed
  }

  // ------------------------------------------------------------------
  // P1: Skills 管理
  // ------------------------------------------------------------------

  /**
   * 注册 Skill（可插拔核心）。
   *
   * 注册时自动把 Skill 内含工具也注册进 _tools，
   * 使 Skill 工具经统一 buildLangchainTools 通路进入图。
   *
   * 对应 Python register_skill：
   *   - is_available() 返回 false 时跳过
   *   - 工具名冲突时跳过该工具并记录警告
   *   - 工具经 SkillToolWrapper 包装，落实执行隔离
   */
  registerSkill(skill: BaseSkill): void {
    if (!skill.isAvailable()) {
      logger.warning("Skill '%s' unavailable (isAvailable=false), skipped", skill.name())
      return
    }
    this._skills.set(skill.name(), skill)
    // 自动注册 Skill 内含工具（可插拔关键：Skill 注册即工具就位）
    // 工具经 SkillToolWrapper 包装，落实执行隔离（P5 降级机制）
    for (const tool of skill.tools()) {
      if (this._tools.has(tool.name())) {
        logger.warning(
          "Skill '%s' tool '%s' name conflicts with existing tool, skipping tool",
          skill.name(), tool.name(),
        )
        continue
      }
      try {
        // 对应 Python: from skills.adapter import SkillToolWrapper
        // 使用注入的工厂避免 ESM 循环依赖；工厂未注册时退回原始工具
        if (_skillToolWrapperFactory) {
          this.registerTool(_skillToolWrapperFactory(tool, skill.name()))
        } else {
          this.registerTool(tool)
        }
      } catch {
        // 包装失败则退回原始工具
        this.registerTool(tool)
      }
    }
    logger.info('Registered skill: %s (tools=%d)', skill.name(), skill.tools().length)
  }

  getSkill(name: string): BaseSkill | undefined {
    return this._skills.get(name)
  }

  listSkills(): Record<string, Record<string, any>> {
    const result: Record<string, Record<string, any>> = {}
    for (const [name, s] of this._skills) {
      result[name] = {
        name: s.name(),
        description: s.description(),
        version: s.version(),
        tags: s.tags(),
        tool_count: s.tools().length,
      }
    }
    return result
  }

  unregisterSkill(name: string): boolean {
    if (this._skills.has(name)) {
      this._skills.delete(name)
      logger.info('Unregistered skill: %s', name)
      return true
    }
    return false
  }

  /**
   * 热替换组件（供进化策略 ComponentSwapStrategy 使用）。
   *
   * 对应 Python swap_component：支持 11 类组件的运行时替换。
   */
  swapComponent(category: string, name: string, component: any): boolean {
    const registries: Record<string, Map<string, any>> = {
      reasoning_engine: this._reasoningEngines,
      reasoning_strategy: this._reasoningStrategies,
      action_executor: this._actionExecutors,
      tool: this._tools,
      memory: this._memories,
      storage_adapter: this._storageAdapters,
      perception: this._perceptions,
      sensor: this._sensors,
      feedback_loop: this._feedbackLoops,
      evolution_signal: this._evolutionSignals,
      skill: this._skills,
    }
    const registry = registries[category]
    if (!registry) {
      logger.error('Unknown component category: %s', category)
      return false
    }
    registry.set(name, component)
    logger.info('Swapped %s component: %s', category, name)
    return true
  }

  listAll(): Record<string, string[]> {
    return {
      reasoning_engines: [...this._reasoningEngines.keys()],
      reasoning_strategies: [...this._reasoningStrategies.keys()],
      action_executors: [...this._actionExecutors.keys()],
      tools: [...this._tools.keys()],
      memories: [...this._memories.keys()],
      storage_adapters: [...this._storageAdapters.keys()],
      perceptions: [...this._perceptions.keys()],
      sensors: [...this._sensors.keys()],
      feedback_loops: [...this._feedbackLoops.keys()],
      evolution_signals: [...this._evolutionSignals.keys()],
      skills: [...this._skills.keys()],
    }
  }
}

// ============================================================
// 全局单例（对应 Python 模块级 _registry + get_registry + reset_registry）
// ============================================================

let _registry: ComponentRegistry | null = null

/**
 * 获取全局 ComponentRegistry 单例。
 *
 * P2-1: 新增 override 参数用于测试隔离。
 * 生产代码不应使用此参数；测试在 teardown 中应调用 resetRegistry() 清理。
 */
export function getRegistry(override?: ComponentRegistry | null): ComponentRegistry {
  if (override !== undefined && override !== null) {
    _registry = override
  }
  if (_registry === null) {
    _registry = new ComponentRegistry()
  }
  return _registry
}

/** 重置全局 registry 单例（测试清理用）。 */
/**
 * 重置全局组件注册表单例（测试隔离 / 热替换用）。
 *
 * P2（T-14）补充：`registerPrompt/getPrompt/...` 委托的是
 * `reasoning/prompt-registry.ts` 的**全局单例**（与 ComponentRegistry 实例生命周期
 * 不同），若此处不同步重置，测试中 `afterEach(resetRegistry)` 将无法清掉
 * 上一用例注册的 prompt 覆盖 → 跨用例污染。故一并重置，使"reset = 全清"成立。
 */
export function resetRegistry(): void {
  _registry = null
  resetPromptRegistry()
}

/**
 * P2-1: 测试用上下文管理器——临时替换全局 registry 单例，退出时自动恢复。
 *
 * 用法：
 *   using scope = overrideRegistry(myRegistry)  // Symbol.dispose
 * 或手动调用返回的 restore() 函数。
 */
export function overrideRegistry(registry: ComponentRegistry): { restore: () => void } {
  const old = _registry
  _registry = registry
  return {
    restore: () => {
      _registry = old
    },
  }
}
