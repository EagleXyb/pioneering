// 对应 Python: evolution/evolution_orchestrator.py
// EvolutionOrchestrator: 进化编排器（接通 feedback/evolution 闭环）

import { getConfig, type RuntimeConfig } from '../config/runtime-config.js'
import { EvolutionSignalCollector } from '../feedback/evolution-signal.js'
import { FeedbackLoop } from '../feedback/loop-controller.js'
import { QualityMonitor } from '../feedback/quality-monitor.js'
import { ParameterTuneStrategy } from './parameter-tune.js'

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
        }
      } catch (e) {
        logger.error('Evolution adjustment failed: %s', String(e))
        result['evolution_action'] = { adjusted: false, error: String(e) }
      }
    }

    return result
  }

  /** 获取累积指标统计。 */
  getCumulativeMetrics(): Record<string, number> {
    return this._feedbackLoop.getCumulativeMetrics()
  }

  /** 重置累积数据。 */
  reset(): void {
    this._feedbackLoop.reset()
  }
}
