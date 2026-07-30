// 自适应终止判定引擎（对应文档 P0-4：自适应终止条件）
//
// 多维度终止判定：
//   维度1: 置信度评估（completeness + consistency + reliability + coverage 加权）
//   维度2: 收敛性检测（最近 N 轮信息增益 < 5%）
//   维度3: 资源消耗（round_count / token_usage）
//
// 第一阶段：advisory 模式
//   - shouldTerminate() 结果写入 state.termination_advice
//   - 不改变 routeAfterAgent 路由行为（仅采集指标）
//   - 第二阶段待 false_positive_rate < 5% 后才真正影响路由
//
// P1-3 扩展：场景化参数动态调优（对应文档 §2.3 动态参数调整 + 风险 R-07）
//   - SCENE_PROFILES 字典覆盖 4 类典型场景（quick_qa / complex_analysis /
//     creative_generation / high_stakes_decision）
//   - tier → scene 自动映射（tier_1→quick_qa，tier_2→complex_analysis，
//     tier_3→high_stakes_decision）
//   - 优先级：runtime_config.scene_profile > tier 映射 > 默认 complex_analysis
//
// 风险控制（对应风险登记表 R-04）：
//   - 触及 routeAfterAgent 核心路由函数
//   - 规避：第一阶段仅 advisory（不改变路由）+ 双重兜底（tool_calls + recursionLimit）
//   - shouldTerminate 仅在 tool_calls 为空时才被参考（第二阶段）

/**
 * 终止决策动作。
 */
export type TerminationAction =
  | 'TERMINATE'           // 正常终止（置信度达标 + 收敛）
  | 'TERMINATE_WITH_CAVEATS' // 终止但携带警告（置信度勉强达标）
  | 'CONTINUE'            // 继续推理
  | 'ESCALATE'            // 升级处理（转人工 / 转更高级模型）

/**
 * 终止决策结果。
 */
export interface TerminationDecision {
  /** 决策动作 */
  action: TerminationAction
  /** 综合置信度（0.0-1.0） */
  confidence: number
  /** 信息增益（最近 N 轮，0.0-1.0） */
  information_gain: number
  /** 决策原因（人类可读） */
  reason: string
  /** 警告信息（TERMINATE_WITH_CAVEATS 时非空） */
  caveats?: string[]
  /** 评估维度详情 */
  dimensions: {
    completeness: number  // 回答完整性 0-1
    consistency: number   // 逻辑一致性 0-1
    reliability: number   // 信息可靠性 0-1
    coverage: number      // 覆盖率 0-1
  }
}

/**
 * 终止判定引擎配置。
 */
export interface TerminationEngineConfig {
  /** 最大轮数 */
  maxRounds: number
  /** 最大 token 消耗 */
  maxTokens: number
  /** 置信度阈值（达到则可终止） */
  confidenceThreshold: number
  /** 信息增益停滞阈值（连续 N 轮增益 < 5% 视为停滞） */
  stagnationThreshold: number
  /** 收敛性检测窗口（最近 N 轮） */
  convergenceWindow: number
}

/**
 * 默认配置（对应 tier_2 场景）。
 */
export const DEFAULT_TERMINATION_CONFIG: TerminationEngineConfig = {
  maxRounds: 15,
  maxTokens: 12000,
  confidenceThreshold: 0.75,
  stagnationThreshold: 3,
  convergenceWindow: 3,
}

// ============================================================
// P1-3: 场景化参数动态调优（对应文档 §2.3 动态参数调整 + 风险 R-07）
// ============================================================

/**
 * 场景标识（对应 DynamicParameterTuner.SCENE_PROFILES）。
 *
 * - quick_qa: 简单问答场景，快速终止
 * - complex_analysis: 复杂分析场景，允许更多轮次
 * - creative_generation: 创意生成场景，基于质量标准而非信息完整度
 * - high_stakes_decision: 高风险决策场景，极高置信度要求
 */
export type SceneProfile =
  | 'quick_qa'
  | 'complex_analysis'
  | 'creative_generation'
  | 'high_stakes_decision'

/**
 * 场景化终止参数配置。
 *
 * 与 TerminationEngineConfig 字段对齐，便于直接构造引擎实例。
 * 额外字段：
 *   - quality_metrics: 创意场景的质量评估维度（目前仅作元数据，不影响决策逻辑）
 *   - mandatory_verification: 高风险场景是否强制二次验证（标记位，第二阶段生效）
 *   - dual_confirmation: 高风险场景是否需要两个独立来源确认（标记位）
 */
export interface SceneProfileConfig extends TerminationEngineConfig {
  /** 场景标识 */
  scene: SceneProfile
  /** 质量评估维度（创意场景） */
  qualityMetrics?: string[]
  /** 是否强制验证（高风险场景） */
  mandatoryVerification?: boolean
  /** 是否需要双源确认（高风险场景） */
  dualConfirmation?: boolean
}

/**
 * 场景化参数映射表（对应文档 §2.3 SCENE_PROFILES）。
 *
 * 设计要点：
 *   1. 每个场景的参数均独立调优，反映该场景的典型特征
 *   2. high_stakes_decision 场景启用 mandatory_verification + dual_confirmation 标记
 *   3. creative_generation 场景标注 quality_metrics，但当前实现仍按置信度判定
 *      （质量评估待 P2 阶段接入 LLM-as-Judge）
 */
export const SCENE_PROFILES: Record<SceneProfile, SceneProfileConfig> = {
  // 简单问答场景：快速终止
  quick_qa: {
    scene: 'quick_qa',
    maxRounds: 3,
    maxTokens: 3000,
    confidenceThreshold: 0.7,
    stagnationThreshold: 2,
    convergenceWindow: 2,
  },
  // 复杂分析场景：允许更多轮次（等价 DEFAULT_TERMINATION_CONFIG）
  complex_analysis: {
    scene: 'complex_analysis',
    maxRounds: 15,
    maxTokens: 12000,
    confidenceThreshold: 0.85,
    stagnationThreshold: 4,
    convergenceWindow: 3,
  },
  // 创意生成场景：基于质量标准而非信息完整度
  creative_generation: {
    scene: 'creative_generation',
    maxRounds: 8,
    maxTokens: 8000,
    confidenceThreshold: 0.75,
    stagnationThreshold: 3,
    convergenceWindow: 3,
    qualityMetrics: ['originality', 'coherence', 'relevance'],
  },
  // 高风险决策场景：极高置信度要求
  high_stakes_decision: {
    scene: 'high_stakes_decision',
    maxRounds: 20,
    maxTokens: 15000,
    confidenceThreshold: 0.95,
    stagnationThreshold: 5,
    convergenceWindow: 4,
    mandatoryVerification: true,
    dualConfirmation: true,
  },
}

/**
 * ComplexityTier 类型别名（避免与 complexity-assessor 循环依赖）。
 *
 * 此处仅用于 tier → scene 映射，不引入运行时依赖。
 */
export type ComplexityTier = 'tier_1' | 'tier_2' | 'tier_3'

/**
 * tier → scene 自动映射（对应文档 §2.3 auto_configure）。
 *
 * - tier_1 → quick_qa（简单查询快速终止）
 * - tier_2 → complex_analysis（标准推理）
 * - tier_3 → high_stakes_decision（深度推理 + 高置信度要求）
 *
 * 注意：creative_generation 场景无对应 tier，需通过 runtime_config 显式指定。
 */
export const TIER_TO_SCENE: Record<ComplexityTier, SceneProfile> = {
  tier_1: 'quick_qa',
  tier_2: 'complex_analysis',
  tier_3: 'high_stakes_decision',
}

/**
 * 根据场景标识构造终止引擎实例（对应文档 §2.3 auto_configure）。
 *
 * 优先级（对应风险 R-07 规避策略）：
 *   1. 显式传入的 scene 参数（最高优先级，用于 runtime_config override）
 *   2. tier 映射（tier_1→quick_qa，tier_2→complex_analysis，tier_3→high_stakes_decision）
 *   3. 默认 complex_analysis（等价 DEFAULT_TERMINATION_CONFIG 行为）
 *
 * @param scene 场景标识（null 时按 tier 映射或默认值）
 * @param tier 复杂度层级（scene 为 null 时使用）
 * @returns 配置好的 AdaptiveTerminationEngine 实例
 */
export function createEngineForScene(
  scene: SceneProfile | null = null,
  tier?: ComplexityTier | null,
): AdaptiveTerminationEngine {
  // 优先级1: 显式 scene
  if (scene) {
    return new AdaptiveTerminationEngine(SCENE_PROFILES[scene])
  }

  // 优先级2: tier 映射
  if (tier) {
    const mappedScene = TIER_TO_SCENE[tier]
    return new AdaptiveTerminationEngine(SCENE_PROFILES[mappedScene])
  }

  // 优先级3: 默认 complex_analysis
  return new AdaptiveTerminationEngine(SCENE_PROFILES.complex_analysis)
}

/**
 * 根据任务特征自动选择场景配置（对应文档 §2.3 auto_configure 的微调逻辑）。
 *
 * 在基础场景配置之上，按任务特征做微调：
 *   - has_time_constraint: 压缩 maxRounds 与 maxTokens
 *   - requires_high_precision: 提升 confidenceThreshold（上限 0.98）
 *
 * @param baseScene 基础场景
 * @param taskAnalysis 任务特征
 * @returns 微调后的配置
 */
export function autoConfigureScene(
  baseScene: SceneProfile,
  taskAnalysis: {
    has_time_constraint?: boolean
    requires_high_precision?: boolean
  } = {},
): SceneProfileConfig {
  const base = SCENE_PROFILES[baseScene]
  const tuned: SceneProfileConfig = { ...base }

  if (taskAnalysis.has_time_constraint) {
    tuned.maxRounds = Math.min(tuned.maxRounds, 5)
    tuned.maxTokens = Math.min(tuned.maxTokens, 5000)
  }

  if (taskAnalysis.requires_high_precision) {
    tuned.confidenceThreshold = Math.min(tuned.confidenceThreshold + 0.1, 0.98)
  }

  return tuned
}

/**
 * 自适应终止判定引擎。
 *
 * 第一阶段：advisory 模式
 *   - shouldTerminate() 返回 TerminationDecision
 *   - 调用方（routeAfterAgent）写入 state.termination_advice，但不改变路由
 *   - 仅采集 confidence_history / information_gain_history 供监控分析
 *
 * 第二阶段（待指标稳定后启用）：
 *   - shouldTerminate() 结果影响 routeAfterAgent 路由
 *   - TERMINATE / TERMINATE_WITH_CAVEATS → '__end__'
 *   - ESCALATE → '__end__'（携带 escalation 标记）
 *   - CONTINUE → 走原有 tool_calls 逻辑
 */
export class AdaptiveTerminationEngine {
  constructor(private config: TerminationEngineConfig = DEFAULT_TERMINATION_CONFIG) {}

  /**
   * 评估是否应终止推理。
   *
   * @param state 当前 ModuAgentState（读取 messages / reasoning_round_count 等）
   * @returns 终止决策
   */
  shouldTerminate(state: Record<string, any>): TerminationDecision {
    // 维度1: 置信度评估
    const dimensions = this._assessConfidence(state)
    const confidence = this._weightedConfidence(dimensions)

    // 维度2: 收敛性检测（信息增益）
    const informationGain = this._assessConvergence(state)

    // 维度3: 资源消耗
    const roundCount = state['reasoning_round_count'] ?? 0
    const tokenUsage = this._estimateTokenUsage(state)

    // 决策逻辑
    const reasons: string[] = []

    // 资源耗尽 → 强制终止
    if (roundCount >= this.config.maxRounds) {
      reasons.push(`round_count ${roundCount} >= max_rounds ${this.config.maxRounds}`)
      return this._buildDecision('TERMINATE_WITH_CAVEATS', confidence, informationGain,
        `Resource limit reached: ${reasons.join('; ')}`,
        ['max_rounds_reached'], dimensions)
    }
    if (tokenUsage >= this.config.maxTokens) {
      reasons.push(`token_usage ${tokenUsage} >= max_tokens ${this.config.maxTokens}`)
      return this._buildDecision('TERMINATE_WITH_CAVEATS', confidence, informationGain,
        `Resource limit reached: ${reasons.join('; ')}`,
        ['max_tokens_reached'], dimensions)
    }

    // 置信度达标 + 收敛 → 正常终止
    if (confidence >= this.config.confidenceThreshold && informationGain < 0.05) {
      return this._buildDecision('TERMINATE', confidence, informationGain,
        `Confidence ${confidence.toFixed(2)} >= ${this.config.confidenceThreshold} and converged`,
        undefined, dimensions)
    }

    // 置信度勉强达标 → 终止但携带警告
    if (confidence >= this.config.confidenceThreshold * 0.85) {
      const caveats: string[] = []
      if (dimensions.coverage < 0.7) caveats.push('low_coverage')
      if (dimensions.reliability < 0.7) caveats.push('low_reliability')
      if (caveats.length > 0) {
        return this._buildDecision('TERMINATE_WITH_CAVEATS', confidence, informationGain,
          `Confidence marginally acceptable with caveats: ${caveats.join(', ')}`,
          caveats, dimensions)
      }
    }

    // 信息增益停滞但置信度不达标 → 升级处理
    if (this._isStagnating(state) && confidence < this.config.confidenceThreshold) {
      return this._buildDecision('ESCALATE', confidence, informationGain,
        `Stagnating (${this.config.stagnationThreshold} rounds) with low confidence ${confidence.toFixed(2)}`,
        ['stagnation_with_low_confidence'], dimensions)
    }

    // 默认：继续推理
    return this._buildDecision('CONTINUE', confidence, informationGain,
      `Confidence ${confidence.toFixed(2)} below threshold ${this.config.confidenceThreshold}, continuing`,
      undefined, dimensions)
  }

  /**
   * 维度1: 置信度评估。
   *
   * 基于 messages 与 tool_results 评估四个子维度：
   *   - completeness: 是否有 tool_results 支持回答（有工具结果 → 高）
   *   - consistency: AIMessage 与 ToolMessage 是否一致（无承诺词 → 高）
   *   - reliability: 工具结果状态是否全 success（无 failed → 高）
   *   - coverage: 工具结果数量是否覆盖 decomposition 子任务
   */
  private _assessConfidence(state: Record<string, any>): {
    completeness: number
    consistency: number
    reliability: number
    coverage: number
  } {
    const messages = state['messages'] ?? []
    const toolResults = state['tool_results'] ?? []
    const assessment = state['complexity_assessment']

    // completeness: 有 tool_results 且最新 AIMessage 无 tool_calls → 完整
    let completeness = 0.5
    if (toolResults.length > 0) {
      const lastMsg = messages[messages.length - 1]
      const hasToolCalls = (lastMsg as any)?.tool_calls?.length > 0
      completeness = hasToolCalls ? 0.6 : 0.9 // 有工具结果且无新 tool_calls → 高完整性
    }

    // consistency: 检查最近 AIMessage 是否含承诺词（含 → 低一致性）
    let consistency = 0.8
    const lastAiMsg = this._findLastAIMessage(messages)
    if (lastAiMsg) {
      const content = typeof lastAiMsg.content === 'string' ? lastAiMsg.content : ''
      const promiseWords = ['然后搜索', '接下来', 'let me then', 'next i will', 'i will now']
      const hasPromise = promiseWords.some((w) => content.toLowerCase().includes(w.toLowerCase()))
      if (hasPromise) consistency = 0.4
    }

    // reliability: 工具结果全 success → 高
    let reliability = 0.9
    if (toolResults.length > 0) {
      const failedCount = toolResults.filter((r: any) => r['status'] === 'failed').length
      reliability = Math.max(0.3, 1 - (failedCount / toolResults.length) * 0.7)
    }

    // coverage: tool_results 数量 vs decomposition 子任务数
    let coverage = 0.7
    if (assessment?.decomposition?.length > 0) {
      const subtaskCount = assessment.decomposition.length
      coverage = Math.min(1.0, toolResults.length / subtaskCount)
    }

    return { completeness, consistency, reliability, coverage }
  }

  /**
   * 加权综合置信度。
   * completeness 0.35 + consistency 0.25 + reliability 0.20 + coverage 0.20
   */
  private _weightedConfidence(d: {
    completeness: number
    consistency: number
    reliability: number
    coverage: number
  }): number {
    return d.completeness * 0.35 + d.consistency * 0.25 + d.reliability * 0.20 + d.coverage * 0.20
  }

  /**
   * 维度2: 收敛性检测。
   *
   * 基于最近的 AIMessage 与前一条的信息差异估算信息增益。
   * 简化实现：若最近 N 轮的 AIMessage 内容相似度高 → 增益低。
   */
  private _assessConvergence(state: Record<string, any>): number {
    const messages = state['messages'] ?? []
    const aiMessages = messages.filter((m: any) => m?.constructor?.name === 'AIMessage' || m?._getType?.() === 'ai')
    if (aiMessages.length < 2) return 1.0 // 首轮信息增益最高

    const lastContent = this._msgContent(aiMessages[aiMessages.length - 1])
    const prevContent = this._msgContent(aiMessages[aiMessages.length - 2])

    // 简化 Jaccard 相似度（按词分割）
    const lastWords = new Set(this._tokenize(lastContent))
    const prevWords = new Set(this._tokenize(prevContent))
    if (lastWords.size === 0) return 0.0

    const intersection = [...lastWords].filter((w) => prevWords.has(w)).length
    const union = new Set([...lastWords, ...prevWords]).size
    const similarity = union > 0 ? intersection / union : 0

    // 信息增益 = 1 - 相似度
    return Math.max(0, 1 - similarity)
  }

  /**
   * 检测推理是否停滞（连续 N 轮信息增益 < 5%）。
   */
  private _isStagnating(state: Record<string, any>): boolean {
    const gainHistory = state['information_gain_history'] ?? []
    if (gainHistory.length < this.config.stagnationThreshold) return false
    const recent = gainHistory.slice(-this.config.stagnationThreshold)
    return recent.every((g: number) => g < 0.05)
  }

  /**
   * 维度3: token 用量估算。
   */
  private _estimateTokenUsage(state: Record<string, any>): number {
    const usage = state['usage']
    if (usage && typeof usage['total_tokens'] === 'number') {
      return usage['total_tokens']
    }
    // 退化估算：messages 总字符数 / 3
    const messages = state['messages'] ?? []
    const totalChars = messages.reduce((sum: number, m: any) => {
      const content = typeof m?.content === 'string' ? m.content : ''
      return sum + content.length
    }, 0)
    return Math.floor(totalChars / 3)
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private _buildDecision(
    action: TerminationAction,
    confidence: number,
    informationGain: number,
    reason: string,
    caveats: string[] | undefined,
    dimensions: { completeness: number; consistency: number; reliability: number; coverage: number },
  ): TerminationDecision {
    return { action, confidence, information_gain: informationGain, reason, caveats, dimensions }
  }

  private _findLastAIMessage(messages: any[]): any {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m?.constructor?.name === 'AIMessage' || m?._getType?.() === 'ai') return m
    }
    return null
  }

  private _msgContent(msg: any): string {
    return typeof msg?.content === 'string' ? msg.content : ''
  }

  private _tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s,，。.;；:：!！?？()（）"'`'\n]+/)
      .filter((w) => w.length >= 2)
      .slice(0, 100) // 限制词数控制计算量
  }
}

/**
 * 默认引擎实例（advisory 模式）。
 */
export const defaultTerminationEngine = new AdaptiveTerminationEngine()
