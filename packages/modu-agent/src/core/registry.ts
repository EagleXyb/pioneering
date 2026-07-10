// 对应 Python: core/registry.py
// ComponentRegistry 单例：管理 11 类组件，支持 swap_component 热替换
import type { BaseActionExecutor, BaseTool } from './interfaces/action.js'
import type { BaseEvolutionSignal, BaseFeedbackLoop } from './interfaces/feedback.js'
import type { BaseMemory, BaseStorageAdapter } from './interfaces/memory.js'
import type { BasePerception, BaseSensor } from './interfaces/perception.js'
import type { BaseReasoningEngine, BaseReasoningStrategy } from './interfaces/reasoning.js'
import type { BaseSkill } from './interfaces/skill.js'

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
export function resetRegistry(): void {
  _registry = null
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
