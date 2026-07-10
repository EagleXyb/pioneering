// 对应 Python: evolution/strategy/parameter_tune.py
// ParameterTuneStrategy: 基于反馈信号的参数调优策略

import type { RuntimeConfig } from '../config/runtime-config.js'
import type { EvolutionSignal } from '../feedback/evolution-signal.js'

/**
 * 基于反馈信号的参数调优策略。
 *
 * P0-2 修复：不再直接修改全局 RuntimeConfig，
 * 而是返回调整建议（config_overrides），
 * 由调用方注入 RunnableConfig.configurable 实现 per-session 覆盖。
 *
 * 对应 Python ParameterTuneStrategy。
 */
export class ParameterTuneStrategy {
  // 调优阈值
  static readonly ACCURACY_THRESHOLD = 0.6
  static readonly ITERATIONS_THRESHOLD = 10
  static readonly TOOL_FAILURE_THRESHOLD = 0.3

  // 调整步长
  static readonly TEMPERATURE_STEP = 0.1
  static readonly MAX_ITERATIONS_STEP = 2

  // 边界值
  static readonly MIN_TEMPERATURE = 0.1
  static readonly MAX_TEMPERATURE = 1.0
  static readonly MIN_MAX_ITERATIONS = 1
  static readonly MAX_MAX_ITERATIONS = 20

  private _config: RuntimeConfig
  private _collector: { getSignals: () => EvolutionSignal[] }

  constructor(
    config: RuntimeConfig,
    feedbackCollector: { getSignals: () => EvolutionSignal[] },
  ) {
    this._config = config
    this._collector = feedbackCollector
  }

  /**
   * 分析进化信号并生成参数调整建议。
   *
   * P0-2 修复：不再修改全局 config，而是返回 config_overrides，
   * 由调用方注入 RunnableConfig.configurable。
   *
   * 策略：
   * - 低准确性 → 降低 temperature（更保守）
   * - 高迭代次数 → 降低 max_iterations（节省资源）
   * - 高工具失败率 → 保持低 temperature
   */
  analyzeAndAdjust(
    signals: EvolutionSignal[],
    sessionId?: string | null,
  ): Record<string, any> {
    if (!signals || signals.length === 0) {
      const currentTemp = this._config.get('llm.temperature', 0.7)
      const currentMaxIter = this._config.get('llm.max_reasoning_iterations', 3)
      return {
        adjusted: false,
        config_overrides: {},
        scope: 'session',
        session_id: sessionId ?? null,
        temperature: currentTemp,
        max_iterations: currentMaxIter,
        reasons: [],
        analyzed_metrics: {},
      }
    }

    // 分析信号提取指标
    const metrics = this._extractMetrics(signals)

    const currentTemp = this._config.get('llm.temperature', 0.7)
    const currentMaxIter = this._config.get('llm.max_reasoning_iterations', 3)

    let newTemp = currentTemp
    let newMaxIter = currentMaxIter
    const reasons: string[] = []

    // 低准确性 → 降低 temperature
    if (metrics.accuracy < ParameterTuneStrategy.ACCURACY_THRESHOLD) {
      newTemp = Math.max(
        ParameterTuneStrategy.MIN_TEMPERATURE,
        currentTemp - ParameterTuneStrategy.TEMPERATURE_STEP,
      )
      reasons.push(
        `低准确性 (${metrics.accuracy.toFixed(2)} < ${ParameterTuneStrategy.ACCURACY_THRESHOLD}) → ` +
        `降低 temperature ${currentTemp} → ${newTemp}`,
      )
    }

    // 高迭代次数 → 降低 max_iterations
    if (metrics.iterations > ParameterTuneStrategy.ITERATIONS_THRESHOLD) {
      newMaxIter = Math.max(
        ParameterTuneStrategy.MIN_MAX_ITERATIONS,
        currentMaxIter - ParameterTuneStrategy.MAX_ITERATIONS_STEP,
      )
      reasons.push(
        `高迭代次数 (${metrics.iterations} > ${ParameterTuneStrategy.ITERATIONS_THRESHOLD}) → ` +
        `降低 max_iterations ${currentMaxIter} → ${newMaxIter}`,
      )
    }

    // 高工具失败率 → 保持低 temperature
    if (metrics.tool_failure_rate > ParameterTuneStrategy.TOOL_FAILURE_THRESHOLD) {
      // 确保 temperature 不会升高
      if (newTemp > currentTemp) {
        newTemp = currentTemp
      }
      reasons.push(
        `高工具失败率 (${metrics.tool_failure_rate.toFixed(2)} > ${ParameterTuneStrategy.TOOL_FAILURE_THRESHOLD}) → ` +
        `保持低 temperature ${newTemp}`,
      )
    }

    // 构建 config_overrides（不再修改全局 config）
    let adjusted = false
    const configOverrides: Record<string, any> = {}

    if (newTemp !== currentTemp) {
      configOverrides['temperature'] = newTemp
      adjusted = true
    }
    if (newMaxIter !== currentMaxIter) {
      configOverrides['max_reasoning_iterations'] = newMaxIter
      adjusted = true
    }

    return {
      adjusted,
      config_overrides: configOverrides,
      scope: 'session',
      session_id: sessionId ?? null,
      temperature: newTemp,
      max_iterations: newMaxIter,
      reasons,
      analyzed_metrics: metrics,
    }
  }

  /**
   * 从进化信号中提取关键指标。
   *
   * @returns 包含 accuracy, iterations, tool_failure_rate 的字典
   */
  private _extractMetrics(signals: EvolutionSignal[]): Record<string, number> {
    let totalToolCalls = 0
    let failedToolCalls = 0
    let iterations = 0
    let accuracySum = 0.0
    let accuracyCount = 0

    for (const signal of signals) {
      // 从信号类型判断
      const signalType = signal.signalType.toLowerCase()
      const metrics = signal.metrics
      const context = signal.context

      // 从 metrics 直接提取 accuracy
      if ('accuracy' in metrics) {
        accuracySum += Number(metrics['accuracy'])
        accuracyCount += 1
      } else if ('accuracy' in context) {
        accuracySum += Number(context['accuracy'])
        accuracyCount += 1
      } else if ('evaluation' in context) {
        const evalData = context['evaluation']
        if (typeof evalData === 'object' && evalData !== null && 'accuracy' in evalData) {
          accuracySum += Number(evalData['accuracy'])
          accuracyCount += 1
        }
      }

      // 从 metrics 直接提取 iterations
      if ('iterations' in metrics) {
        iterations += Number(metrics['iterations'])
      } else if (signalType.includes('reasoning') || signalType.includes('generate')) {
        iterations += Number(metrics['event_count'] ?? 1)
      }

      // 统计工具调用和失败
      if (signalType.includes('tool') || signalType.includes('tool_failure')) {
        totalToolCalls += 1
        const metadata = context['metadata'] ?? {}
        const toolStatus: string = metadata['tool_status'] ?? ''
        const toolFailureRate: number = Number(metrics['tool_failure_rate'] ?? 0.0)
        if (toolStatus === 'failed' || toolStatus === 'error' || toolFailureRate > 0) {
          failedToolCalls += 1
        }
        // 从 metrics 提取失败率
        if ('tool_failure_rate' in metrics) {
          failedToolCalls = Math.floor(metrics['tool_failure_rate'] * totalToolCalls)
        }
      }
    }

    // 计算最终指标
    const accuracy = accuracyCount > 0 ? accuracySum / accuracyCount : 1.0
    const toolFailureRate = totalToolCalls > 0 ? failedToolCalls / totalToolCalls : 0.0

    return {
      accuracy,
      iterations,
      tool_failure_rate: toolFailureRate,
      total_tool_calls: totalToolCalls,
      failed_tool_calls: failedToolCalls,
    }
  }
}
