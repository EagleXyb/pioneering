// 对应 Python: evolution/strategy/component_swap.py
// ComponentSwapStrategy: 基于质量对比的组件热替换策略

import type { ComponentRegistry } from '../core/registry.js'
import type { EvolutionSignalCollector } from '../feedback/evolution-signal.js'

// T1-2：applySwap 需要日志（此前本文件无 logger 定义，决策路径完全静默）
const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[component-swap] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[component-swap] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[component-swap] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[component-swap] ${msg}`, ...args),
}

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

  /**
   * T1-2：**执行**组件热替换（`shouldSwap` 此前只做决策、从不落地）。
   *
   * 原设计缺口：`shouldSwap` 纯计算，真正写入注册表的 `registry.swapComponent`
   * 全仓无调用方 → 组件层"进化"实际从未发生。本方法补齐执行侧。
   *
   * @param componentName 组件名（注册表中的键）
   * @param category      注册表分类（`swapComponent` 的 category 参数，见
   *                      `registry.ts` 的 11 类映射：tool/perception/memory/... ）
   * @param versions      形如 `{ current, candidate, components: { current, candidate } }`：
   *                      `components` 给出两个版本对应的**组件实例**，用于写入注册表
   * @returns 是否发生了替换
   */
  applySwap(
    componentName: string,
    category: string,
    versions: {
      current: string
      candidate: string
      components: { current: any; candidate: any }
    },
    threshold?: number | null,
  ): boolean {
    if (!this.shouldSwap(componentName, versions.current, versions.candidate, threshold)) {
      return false
    }
    const candidate = versions.components?.candidate
    if (candidate === undefined || candidate === null) {
      logger.error(
        'applySwap aborted: candidate component instance missing for %s/%s',
        category,
        componentName,
      )
      return false
    }
    const success = this._registry.swapComponent(category, componentName, candidate)
    if (success) {
      logger.info(
        'Applied component swap: %s/%s %s -> %s',
        category,
        componentName,
        versions.current,
        versions.candidate,
      )
    }
    return success
  }

  /**
   * T1-2：暴露受保护的注册表（供编排层在**记录分数前**抓取当前版本实例）。
   *
   * 此前 `_registry` 仅在构造时注入却从不使用；组件替换需要"当前实例"才能
   * 构造完整快照，故提供只读访问器而非改动既有可见性。
   */
  get registry(): ComponentRegistry {
    return this._registry
  }
}
