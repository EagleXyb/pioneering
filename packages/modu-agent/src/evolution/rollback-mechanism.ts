// 对应 Python: evolution/registry/rollback_mechanism.py
// RollbackMechanism: 基于质量回退的自动回滚机制

import type { ComponentRegistry } from '../core/registry.js'
import type { VersionedComponentStore } from './versioned-store.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[rollback] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[rollback] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[rollback] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[rollback] ${msg}`, ...args),
}

/** 版本与质量得分记录。 */
export type QualityRecord = [string, number]

/**
 * 基于质量回退的自动回滚机制。
 *
 * 对应 Python RollbackMechanism。
 * 依赖 VersionedComponentStore 的版本快照与 ComponentRegistry 的热替换能力。
 */
export class RollbackMechanism {
  private _versionStore: VersionedComponentStore
  private _registry: ComponentRegistry
  private _rollbackThreshold: number
  private _qualityRecords: Map<string, QualityRecord[]>
  private _rollbackCount: number

  constructor(
    versionStore: VersionedComponentStore,
    registry: ComponentRegistry,
    rollbackThreshold: number = 0.7,
  ) {
    this._versionStore = versionStore
    this._registry = registry
    this._rollbackThreshold = rollbackThreshold
    this._qualityRecords = new Map()
    this._rollbackCount = 0
  }

  /**
   * 记录质量得分并在需要时回滚。
   *
   * @returns 是否发生了回滚
   */
  recordAndCheck(
    componentName: string,
    version: string,
    qualityScore: number,
  ): boolean {
    if (!this._qualityRecords.has(componentName)) {
      this._qualityRecords.set(componentName, [])
    }
    this._qualityRecords.get(componentName)!.push([version, qualityScore])

    logger.info(
      'Recorded quality score %.3f for %s version %s',
      qualityScore,
      componentName,
      version,
    )

    if (qualityScore < this._rollbackThreshold) {
      logger.warning(
        'Quality score %.3f below threshold %.3f for %s',
        qualityScore,
        this._rollbackThreshold,
        componentName,
      )
      const stableVersion = this._findStableVersion(componentName)
      if (stableVersion) {
        return this.rollbackToVersion(componentName, stableVersion)
      } else {
        logger.error(
          'No stable version found for %s to rollback to',
          componentName,
        )
        return false
      }
    }

    return false
  }

  /**
   * 回滚到指定版本。
   *
   * 流程：
   * 1. 从 version_store 获取版本快照
   * 2. 调用 registry.swapComponent() 应用版本
   * 3. 记录回滚事件
   */
  rollbackToVersion(componentName: string, version: string): boolean {
    const snapshot = this._versionStore.getVersion(componentName, version)
    if (snapshot === null) {
      logger.error(
        'Failed to get snapshot for %s version %s',
        componentName,
        version,
      )
      return false
    }

    const category = snapshot['category']
    const component = snapshot['component']

    if (category === undefined || category === null || component === undefined || component === null) {
      logger.error(
        'Invalid snapshot format for %s version %s',
        componentName,
        version,
      )
      return false
    }

    const success = this._registry.swapComponent(category, componentName, component)
    if (success) {
      this._rollbackCount += 1
      logger.info(
        'Successfully rolled back %s to version %s (rollback #%d)',
        componentName,
        version,
        this._rollbackCount,
      )
    }
    return success
  }

  /** 找到满足质量阈值的最稳定版本。 */
  private _findStableVersion(componentName: string): string | null {
    const records = this._qualityRecords.get(componentName) ?? []
    // 从最近记录向前查找（对应 Python reversed(records)）
    for (let i = records.length - 1; i >= 0; i--) {
      const [version, score] = records[i]
      if (score >= this._rollbackThreshold) {
        return version
      }
    }
    return null
  }

  /** 获取组件的质量历史记录。 */
  getQualityHistory(componentName: string): QualityRecord[] {
    return this._qualityRecords.get(componentName) ?? []
  }

  /** 获取回滚总次数。 */
  getRollbackCount(): number {
    return this._rollbackCount
  }
}
