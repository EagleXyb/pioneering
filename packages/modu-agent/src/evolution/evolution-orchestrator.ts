// 对应 Python: evolution/evolution_orchestrator.py
// EvolutionOrchestrator: 进化编排器（接通 feedback/evolution 闭环）

import { getConfig, type RuntimeConfig } from '../config/runtime-config.js'
import { EvolutionSignalCollector } from '../feedback/evolution-signal.js'
import { FeedbackLoop } from '../feedback/loop-controller.js'
import { QualityMonitor } from '../feedback/quality-monitor.js'
import { ParameterTuneStrategy } from './parameter-tune.js'
// T1-2：组件层进化（此前三者仅被 index.ts 导出与单测引用，运行时装配从未实例化）
import { ComponentSwapStrategy } from './component-swap.js'
import { RollbackMechanism } from './rollback-mechanism.js'
import { VersionedComponentStore } from './versioned-store.js'
import { getRegistry } from '../core/registry.js'
// P0（T-02）: 指标埋点（进化触发计数）
import { get_metrics_registry } from '../observability/metrics.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[evolution-orchestrator] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[evolution-orchestrator] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[evolution-orchestrator] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[evolution-orchestrator] ${msg}`, ...args),
}

/**
 * 进化编排器：协调 feedback 评估与 evolution 策略。
 *
 * P0-1: 接通 feedback/evolution 闭环，将以下断裂点连接：
 * - response → FeedbackLoop.evaluate（评估响应质量）
 * - should_evolve → evolution_threshold（读取配置阈值）
 * - should_evolve=True → ParameterTuneStrategy（触发参数调优）
 *
 * 对应 Python EvolutionOrchestrator。
 *
 * 被 graph/factory.ts 和 graph/nodes.ts 引用：
 * - 构造函数接收 evaluator_llm 参数
 * - evaluate_and_evolve(output, context, session_id) 异步方法
 *   返回 {evaluation, should_evolve, evolution_action}
 * - evolution_action 结构含 {adjusted: bool, config_overrides: {...}}
 */
export class EvolutionOrchestrator {
  private _evolutionCollector: EvolutionSignalCollector
  private _feedbackLoop: FeedbackLoop
  private _parameterTune: ParameterTuneStrategy | null
  // T1-2：组件层进化三件套。默认 null（开关关闭 → 与引入前行为逐字节一致）。
  private _componentSwap: ComponentSwapStrategy | null = null
  private _rollback: RollbackMechanism | null = null
  private _versionStore: VersionedComponentStore | null = null

  /**
   * 初始化进化编排器。
   *
   * @param feedbackLoop 反馈循环控制器（null=自动创建）
   * @param evolutionCollector 进化信号收集器（null=自动创建）
   * @param parameterTune 参数调优策略（null=自动创建）
   * @param evaluatorLlm P2-7 LLM-as-Judge 评估器（null=按配置决定是否创建）。
   *   当 feedback.quality_monitor_mode 为 "llm"/"hybrid" 时启用。
   */
  constructor(
    feedbackLoop?: FeedbackLoop | null,
    evolutionCollector?: EvolutionSignalCollector | null,
    parameterTune?: ParameterTuneStrategy | null,
    evaluatorLlm?: any | null,
  ) {
    const config = getConfig()

    this._evolutionCollector = evolutionCollector ?? new EvolutionSignalCollector(
      config.get('perception.evolution_report_interval', 100),
    )

    // T1-1 修复（接线）：此前 collector 仅由 event-bridge 主动投递，而
    // consensus 失败、guardrail 命中等信号是**直接 publish 到 EventBus** 的
    // （consensus.ts / perception/security/audit.ts），从不经过 event-bridge
    // → 事件"发而不收"，进化闭环实际断开。
    // 此处订阅全局总线，使非流式路径的事件同样进入信号收集。
    // 失败不阻断构造（attachEventBus 内部已兜底为空操作）。
    try {
      this._evolutionCollector.attachEventBus()
    } catch (e) {
      logger.warning(
        'EvolutionSignalCollector.attachEventBus failed (进化信号将仅来自 event-bridge): %s',
        String(e),
      )
    }

    // P2-7: 按 config 构造 QualityMonitor（支持 LLM-as-Judge）
    if (feedbackLoop === null || feedbackLoop === undefined) {
      const qualityMonitor = EvolutionOrchestrator._buildQualityMonitor(config, evaluatorLlm)
      this._feedbackLoop = new FeedbackLoop(
        qualityMonitor,
        null,
        this._evolutionCollector,
        config.get('feedback.min_sample_size', 10),
      )
    } else {
      this._feedbackLoop = feedbackLoop
    }

    // 参数调优策略（对应 Python 延迟初始化）
    this._parameterTune = parameterTune ?? null
    if (this._parameterTune === null) {
      try {
        this._parameterTune = new ParameterTuneStrategy(
          config,
          this._evolutionCollector,
        )
      } catch (e) {
        logger.warning('ParameterTuneStrategy init failed: %s', String(e))
        this._parameterTune = null
      }
    }

    // T1-2 修复（接线）：组件层进化三件套此前**从未被实例化** ——
    // ComponentSwapStrategy 只做决策不执行、RollbackMechanism /
    // VersionedComponentStore 连构造都没有调用方（仅 evolution/index.ts 导出
    // 与单测引用），导致"组件层进化"完全不存在。
    // 按仓库既有 feature-flag 纪律**默认关闭**：关闭时下方全部为 null，
    // evaluateAndEvolve 跳过组件层，行为与引入前完全一致。
    this._initComponentLayer(config)
  }

  /**
   * T1-2：按配置实例化组件层进化（热替换 + 版本回滚）。
   *
   * 分两个独立开关：
   *   - `feedback.enable_component_swap`：记录质量分并在满足阈值时执行替换
   *   - `feedback.enable_auto_rollback`：质量分低于阈值时回滚到最近达标版本
   * 各自失败只降级为 null（该子能力不可用），不影响另一子能力与主闭环。
   */
  private _initComponentLayer(config: RuntimeConfig): void {
    const swapEnabled = Boolean(config.get('feedback.enable_component_swap', false))
    const rollbackEnabled = Boolean(config.get('feedback.enable_auto_rollback', false))
    if (!swapEnabled && !rollbackEnabled) {
      return
    }
    try {
      const registry = getRegistry()
      if (rollbackEnabled) {
        try {
          this._versionStore = new VersionedComponentStore(
            String(config.get('feedback.version_store_path', 'evolution/versions')),
          )
          this._rollback = new RollbackMechanism(
            this._versionStore,
            registry,
            Number(config.get('feedback.auto_rollback_threshold', 0.7)),
          )
        } catch (e) {
          logger.warning('RollbackMechanism init failed (component rollback disabled): %s', String(e))
          this._rollback = null
          this._versionStore = null
        }
      }
      if (swapEnabled) {
        try {
          this._componentSwap = new ComponentSwapStrategy(
            registry,
            this._evolutionCollector,
            Number(config.get('feedback.component_swap_threshold', 0.05)),
          )
        } catch (e) {
          logger.warning('ComponentSwapStrategy init failed (component swap disabled): %s', String(e))
          this._componentSwap = null
        }
      }
      logger.info(
        'Component layer evolution wired: swap=%s rollback=%s',
        this._componentSwap !== null,
        this._rollback !== null,
      )
    } catch (e) {
      logger.warning('Component layer init failed, parameter layer unaffected: %s', String(e))
    }
  }

  /**
   * P2-7: 根据 config 和 evaluator_llm 构造 QualityMonitor。
   *
   * 构造规则：
   *   - mode="rule"（默认）→ 不需要 evaluator_llm，规则模式
   *   - mode="llm"/"hybrid" 且 evaluator_llm 提供 → 启用 LLM Judge
   *   - mode="llm"/"hybrid" 但 evaluator_llm 缺失 → QualityMonitor 内部自动降级为 rule
   */
  static _buildQualityMonitor(
    config: RuntimeConfig,
    evaluatorLlm: any,
  ): QualityMonitor {
    const mode = config.get('feedback.quality_monitor_mode', 'rule')
    const llmTimeout = config.get('feedback.quality_monitor_llm_timeout', 10.0)
    const llmTemperature = config.get('feedback.quality_monitor_llm_temperature', 0.0)
    const llmMaxTokens = config.get('feedback.quality_monitor_llm_max_tokens', 256)

    return new QualityMonitor(
      evaluatorLlm,
      mode,
      llmTimeout,
      llmTemperature,
      llmMaxTokens,
    )
  }

  get feedbackLoop(): FeedbackLoop {
    return this._feedbackLoop
  }

  get evolutionCollector(): EvolutionSignalCollector {
    return this._evolutionCollector
  }

  /**
   * 评估输出质量并决定是否触发进化。
   *
   * P0-1 闭环核心方法，在 feedback_node 中调用。
   *
   * P0-2 修复：将 session_id 传递给 ParameterTuneStrategy，
   * 使其返回的 config_overrides 带有会话标识，
   * 由调用方注入 RunnableConfig.configurable 实现 per-session 覆盖。
   *
   * @param output 输出字典，包含 response / tool_results / usage
   * @param context 上下文字典，包含 prompt / perception_result 等
   * @param sessionId 会话标识（用于参数调优的作用域标记）
   * @returns 评估与进化结果字典：
   *   {
   *     evaluation,           // 质量评估结果
   *     should_evolve,         // 是否应进化
   *     evolution_action,      // 进化动作（参数调优等）
   *     sample_count,          // 累积样本数
   *   }
   */
  async evaluateAndEvolve(
    output: Record<string, any>,
    context: Record<string, any>,
    sessionId?: string | null,
  ): Promise<Record<string, any>> {
    // 1. 评估输出质量
    let evaluation: Record<string, any>
    try {
      evaluation = await this._feedbackLoop.evaluate(output, context)
    } catch (e) {
      logger.error('Feedback evaluation failed: %s', String(e))
      evaluation = { quality_score: 0.0, error: String(e) }
    }

    // 2. 读取进化阈值配置并判断是否应进化
    const config = getConfig()
    const threshold = config.get('feedback.evolution_threshold', 0.6)
    const shouldEvolve = this._feedbackLoop.shouldEvolve(
      evaluation as Record<string, number>,
      threshold,
    )

    const result: Record<string, any> = {
      evaluation,
      should_evolve: shouldEvolve,
      evolution_action: null,
      sample_count: this._feedbackLoop.getSampleCount(),
    }

    // 3. 触发参数调优（P0-2: 传递 session_id，返回 config_overrides 而非修改全局）
    if (shouldEvolve && this._parameterTune !== null) {
      try {
        const signals = this._evolutionCollector.getSignals()
        // 将评估结果注入信号 context，供 ParameterTuneStrategy 提取
        if (signals.length > 0) {
          const sampleCount = this._feedbackLoop.getSampleCount()
          const recentSignals = signals.slice(-sampleCount)
          for (const signal of recentSignals) {
            if (!('evaluation' in signal.context)) {
              signal.context['evaluation'] = evaluation
            }
          }
        }

        const evolutionAction = this._parameterTune.analyzeAndAdjust(
          signals,
          sessionId ?? null,
        )
        result['evolution_action'] = evolutionAction

        if (evolutionAction['adjusted']) {
          logger.info(
            'Evolution triggered: sample_count=%d quality_score=%.3f threshold=%.2f session_id=%s reasons=%s',
            this._feedbackLoop.getSampleCount(),
            evaluation['quality_score'] ?? 0.0,
            threshold,
            sessionId ?? 'unknown',
            evolutionAction['reasons'] ?? [],
          )
          // P0（T-02）: 指标埋点 —— 进化触发计数（此前 record_evolution 零消费者）。
          // metrics 未启用时 record_* 内部直接 return（no-op）。
          try {
            get_metrics_registry().record_evolution()
          } catch (e) {
            logger.debug('record_evolution failed: %s', String(e))
          }
          // T1-2：组件层进化（开关关闭时 `_componentLayerStep` 直接返回 null）
          const componentAction = this._componentLayerStep(evaluation, context)
          if (componentAction !== null) {
            result['component_action'] = componentAction
          }
        }
      } catch (e) {
        logger.error('Evolution adjustment failed: %s', String(e))
        result['evolution_action'] = { adjusted: false, error: String(e) }
      }
    }

    return result
  }

  /**
   * T1-2：组件层进化的一步（记录质量分 → 尝试替换/回滚）。
   *
   * 触发条件：两个开关均默认关闭，故宿主需显式开启
   * `feedback.enable_component_swap` / `feedback.enable_auto_rollback`。
   *
   * 保守契约（重要）：**不猜测宿主意图**。宿主需在 `context` 中显式声明
   * 可参与组件层进化的组件：
   *   - `context.evolution_component`     = { name, category, current_version, candidate_version }
   *     或
   *   - `context.evolution_candidates`    = [{ name, category, current_version, candidate_version }]
   * 未声明时本步返回 null（不做任何猜测性替换），避免替换掉不该被替换的运行中组件。
   *
   * @returns 组件层动作结果；未启用/无声明/无动作时返回 null
   */
  private _componentLayerStep(
    evaluation: Record<string, any>,
    context: Record<string, any>,
  ): Record<string, any> | null {
    if (this._componentSwap === null && this._rollback === null) {
      return null
    }
    // 显式声明的候选组件（保守：仅宿主明确给出时才动手）
    const rawCandidates = context?.['evolution_candidates']
    const single = context?.['evolution_component']
    const candidates: Array<Record<string, any>> = Array.isArray(rawCandidates)
      ? rawCandidates
      : (single ? [single] : [])
    if (candidates.length === 0) {
      return null
    }

    const qualityScore = Number(evaluation?.['quality_score'])
    if (!Number.isFinite(qualityScore)) {
      logger.debug('component layer skipped: quality_score not finite')
      return null
    }

    const actions: Array<Record<string, any>> = []
    for (const cand of candidates) {
      const name = String(cand?.['name'] ?? '')
      const category = String(cand?.['category'] ?? '')
      const currentVersion = String(cand?.['current_version'] ?? '')
      const candidateVersion = String(cand?.['candidate_version'] ?? '')
      if (!name || !category || !currentVersion || !candidateVersion) {
        logger.warning('component layer skipped: incomplete candidate %o', cand)
        continue
      }

      // 1) 记录当前版本质量分（两条路径共用）
      if (this._componentSwap !== null) {
        try {
          this._componentSwap.recordScore(name, currentVersion, qualityScore)
          this._componentSwap.recordScore(name, candidateVersion, qualityScore)
        } catch (e) {
          logger.warning('recordScore failed for %s: %s', name, String(e))
        }
      }

      // 2) 替换：仅当宿主提供了候选实例时执行
      if (this._componentSwap !== null && cand['candidate_component'] != null) {
        try {
          const swapped = this._componentSwap.applySwap(
            name,
            category,
            {
              current: currentVersion,
              candidate: candidateVersion,
              components: {
                current: null,
                candidate: cand['candidate_component'],
              },
            },
          )
          actions.push({ type: 'swap', component: name, applied: swapped })
        } catch (e) {
          logger.error('component swap failed for %s: %s', name, String(e))
          actions.push({ type: 'swap', component: name, applied: false, error: String(e) })
        }
      }

      // 3) 回滚：质量低于阈值时回退到最近达标版本
      if (this._rollback !== null) {
        try {
          const rolledBack = this._rollback.recordAndCheck(name, currentVersion, qualityScore)
          actions.push({ type: 'rollback', component: name, applied: rolledBack })
        } catch (e) {
          logger.error('component rollback failed for %s: %s', name, String(e))
          actions.push({ type: 'rollback', component: name, applied: false, error: String(e) })
        }
      }
    }

    if (actions.length === 0) {
      return null
    }
    return { quality_score: qualityScore, actions }
  }

  /** 获取累积指标统计。 */
  getCumulativeMetrics(): Record<string, number> {
    return this._feedbackLoop.getCumulativeMetrics()
  }

  /** 重置累积数据。 */
  reset(): void {
    this._feedbackLoop.reset()
  }

  /**
   * T1-1：释放 EventBus 订阅。
   *
   * EventBus 是**全局单例**且按 domain 做并集分发，collector 订阅后即长驻；
   * 若 orchestrator 被反复重建（create_agent 多次 / 测试场景）而不释放，
   * 旧 collector 会持续接收事件 → 信号重复计数 + 内存泄漏。
   * 宿主在销毁 agent 实例时应调用本方法。
   */
  dispose(): void {
    try {
      this._evolutionCollector.detachEventBus()
    } catch (e) {
      logger.debug('dispose: detachEventBus failed: %s', String(e))
    }
  }
}
