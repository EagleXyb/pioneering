// 对应 Python: feedback/loop_controller.py
// FeedbackLoop: 反馈循环控制器（继承 BaseFeedbackLoop）

import { BaseFeedbackLoop } from '../core/interfaces/feedback.js'
import { EvolutionSignalCollector } from './evolution-signal.js'
import { AccuracyMetrics } from './metrics/accuracy.js'
import { QualityMonitor } from './quality-monitor.js'

/**
 * 反馈循环控制器：评估响应质量，决定是否触发进化。
 *
 * 评估维度：
 * - 相关性（relevance）：回答与问题的关联程度
 * - 完整性（completeness）：回答是否完整覆盖问题
 * - 准确性（accuracy）：事实性错误的数量
 * - 工具效用（tool_effectiveness）：工具调用是否成功
 *
 * 对应 Python FeedbackLoop（继承 BaseFeedbackLoop）。
 */
export class FeedbackLoop extends BaseFeedbackLoop {
  private _qualityMonitor: QualityMonitor
  private _accuracyMetrics: AccuracyMetrics
  private _evolutionCollector: EvolutionSignalCollector | null
  private _minSampleSize: number
  private _sampleCount: number
  private _cumulativeMetrics: Record<string, number[]>

  constructor(
    qualityMonitor?: QualityMonitor | null,
    accuracyMetrics?: AccuracyMetrics | null,
    evolutionCollector?: EvolutionSignalCollector | null,
    minSampleSize: number = 10,
  ) {
    super()
    this._qualityMonitor = qualityMonitor ?? new QualityMonitor()
    this._accuracyMetrics = accuracyMetrics ?? new AccuracyMetrics()
    this._evolutionCollector = evolutionCollector ?? null
    this._minSampleSize = minSampleSize
    this._sampleCount = 0
    this._cumulativeMetrics = {}
  }

  /**
   * 评估单次输出的质量。
   *
   * P2-7: 改用 QualityMonitor.evaluateAsync() 以支持 LLM-as-Judge 模式。
   * 当 quality_monitor 为规则模式时，evaluateAsync 退化为同步调用，无额外开销。
   */
  async evaluate(
    output: Record<string, any>,
    context: Record<string, any>,
  ): Promise<Record<string, any>> {
    const prompt = context['prompt'] ?? ''
    const response = output['response'] ?? ''
    const toolResults = output['tool_results'] ?? []
    const _usage = output['usage'] ?? {}

    // 使用 QualityMonitor 评估响应质量（异步，支持 LLM/hybrid 模式）
    const qualityResult = await this._qualityMonitor.evaluateAsync(
      prompt,
      response,
      context,
    )

    // 使用 AccuracyMetrics 计算工具调用准确性
    const accuracyResult = this._accuracyMetrics.calculate(toolResults)

    // 构建评估结果
    // P2-7: 若 LLM 已返回 accuracy 维度，优先使用 LLM 的；否则使用工具调用准确率
    const llmAccuracy = qualityResult['accuracy']
    const accuracyScore =
      llmAccuracy !== undefined && llmAccuracy !== null
        ? llmAccuracy
        : (accuracyResult['success_rate'] ?? 0.0)

    const evaluation: Record<string, any> = {
      relevance: qualityResult['relevance'] ?? 0.0,
      completeness: qualityResult['completeness'] ?? 0.0,
      accuracy: accuracyScore,
      tool_effectiveness: accuracyResult['success_rate'] ?? 0.0,
      quality_score: qualityResult['overall'] ?? 0.0,
      accuracy_details: accuracyResult,
      quality_details: qualityResult,
    }

    // 累积样本
    this._accumulateSample(evaluation)

    return evaluation
  }

  /** 累积评估样本用于统计。 */
  private _accumulateSample(evaluation: Record<string, any>): void {
    this._sampleCount += 1

    const keys = ['relevance', 'completeness', 'accuracy', 'tool_effectiveness', 'quality_score']
    for (const key of keys) {
      if (!(key in this._cumulativeMetrics)) {
        this._cumulativeMetrics[key] = []
      }
      this._cumulativeMetrics[key].push(evaluation[key] ?? 0.0)
    }
  }

  /**
   * 判断是否应触发进化。
   *
   * P1-6 修复：统一数据源，全部使用内部累积状态 _cumulative_metrics
   * 判断，消除原先"传入参数 metrics 做门控 + 内部累积状态算比率"
   * 双数据源不一致的问题。metrics 参数保留以兼容现有调用方
   * （EvolutionOrchestrator 传入完整 evaluation 字典），
   * 其 quality_score 已在 evaluate() 中通过 _accumulate_sample
   * 累积到内部状态，故决策仅依赖内部累积状态。
   *
   * 触发条件：样本量充足 且 最近 min_sample_size 次评估中
   * 有 60%+ 的 quality_score 低于阈值。
   */
  shouldEvolve(metrics: Record<string, number>, threshold: number): boolean {
    // 样本量不足，不触发进化
    if (this._sampleCount < this._minSampleSize) {
      return false
    }

    // P1-6: 统一使用内部累积状态判断，不再用传入 metrics 的 quality_score 做门控
    const recentScores = this._cumulativeMetrics['quality_score'] ?? []
    if (recentScores.length >= this._minSampleSize) {
      const window = recentScores.slice(-this._minSampleSize)
      let lowCount = 0
      for (const s of window) {
        if (s < threshold) {
          lowCount += 1
        }
      }
      const recentLowRatio = lowCount / this._minSampleSize
      return recentLowRatio >= 0.6  // 60% 以上低于阈值
    }
    return false
  }

  /** 获取累积指标统计（各维度平均值与最新值）。 */
  getCumulativeMetrics(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [key, values] of Object.entries(this._cumulativeMetrics)) {
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0)
        result[`${key}_avg`] = sum / values.length
        result[`${key}_latest`] = values[values.length - 1]
      }
    }
    return result
  }

  /** 获取已评估样本数。 */
  getSampleCount(): number {
    return this._sampleCount
  }

  /** 重置累积数据和样本计数。 */
  reset(): void {
    this._sampleCount = 0
    this._cumulativeMetrics = {}
  }
}
