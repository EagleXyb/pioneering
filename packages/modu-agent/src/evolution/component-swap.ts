// 对应 Python: evolution/strategy/component_swap.py
// ComponentSwapStrategy: 基于质量对比的组件热替换策略

import type { ComponentRegistry } from '../core/registry.js'
import type { EvolutionSignalCollector } from '../feedback/evolution-signal.js'

/**
 * 基于质量对比的组件热替换策略。
 *
 * 对应 Python ComponentSwapStrategy。
 */
export class ComponentSwapStrategy {
  private _registry: ComponentRegistry
  private _feedbackCollector: EvolutionSignalCollector
  private _threshold: number
  private _performanceHistory: Map<string, number[]>

  constructor(
    registry: ComponentRegistry,
    feedbackCollector: EvolutionSignalCollector,
    threshold: number = 0.05,
  ) {
    this._registry = registry
    this._feedbackCollector = feedbackCollector
    this._threshold = threshold
    this._performanceHistory = new Map()
  }

  /**
   * 记录组件版本的得分。
   *
   * @param componentName 组件名称
   * @param version 版本标识
   * @param score A/B 测试得分
   */
  recordScore(componentName: string, version: string, score: number): void {
    const key = `${componentName}:${version}`
    if (!this._performanceHistory.has(key)) {
      this._performanceHistory.set(key, [])
    }
    this._performanceHistory.get(key)!.push(score)
  }

  /**
   * 获取组件版本的平均得分。
   *
   * @returns 平均得分，如果无历史数据则返回 null
   */
  private _getAverageScore(componentName: string, version: string): number | null {
    const key = `${componentName}:${version}`
    const scores = this._performanceHistory.get(key)
    if (!scores || scores.length === 0) {
      return null
    }
    const sum = scores.reduce((a, b) => a + b, 0)
    return sum / scores.length
  }

  /**
   * 判断是否应切换组件。
   *
   * 条件：候选版本平均得分 > 当前版本平均得分 + 阈值
   *
   * @param componentName 组件名称
   * @param currentVersion 当前版本
   * @param candidateVersion 候选版本
   * @param threshold 切换阈值，默认使用构造函数传入的值
   * @returns 是否应切换到候选版本
   */
  shouldSwap(
    componentName: string,
    currentVersion: string,
    candidateVersion: string,
    threshold?: number | null,
  ): boolean {
    const effectiveThreshold = threshold ?? this._threshold

    const currentAvg = this._getAverageScore(componentName, currentVersion)
    const candidateAvg = this._getAverageScore(componentName, candidateVersion)

    if (currentAvg === null || candidateAvg === null) {
      return false
    }

    return candidateAvg > currentAvg + effectiveThreshold
  }
}
