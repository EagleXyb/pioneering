// 对应 Python: components/perception/fusion.py
// 多路感知融合器（对应问题 9：多感知融合）
//
// 当同一输入有多个感知器处理（如文本 + 图像 + 音频）时，
// 将多路结果按权重融合，输出统一的感知结果。
//
// 支持的融合策略：
// - weighted_average: 按模态权重加权平均
// - max_confidence: 取置信度最高的结果
// - voting: 多数投票（用于敏感度等离散字段）

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[fusion] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[fusion] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[fusion] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[fusion] ${msg}`, ...args),
}

// 默认模态权重
const _DEFAULT_WEIGHTS: Record<string, number> = {
  text: 0.5,
  image: 0.3,
  audio: 0.2,
}

/**
 * 多路感知结果融合器。
 * 对应 Python PerceptionFusion。
 */
export class PerceptionFusion {
  private _strategy: string
  private _weights: Record<string, number>

  constructor(
    strategy: string = 'weighted_average',
    weights?: Record<string, number> | null,
  ) {
    this._strategy = strategy
    this._weights = weights ?? _DEFAULT_WEIGHTS
  }

  /**
   * 融合多路感知结果。
   * 对应 Python fuse。
   *
   * @param results 多个感知器的输出列表
   * @returns 融合后的单一感知结果
   */
  fuse(results: Array<Record<string, any>>): Record<string, any> {
    if (results.length === 0) {
      return this._emptyResult()
    }

    if (results.length === 1) {
      return results[0]
    }

    if (this._strategy === 'max_confidence') {
      return this._fuseMaxConfidence(results)
    } else if (this._strategy === 'voting') {
      return this._fuseVoting(results)
    } else {
      return this._fuseWeightedAverage(results)
    }
  }

  /** 加权平均融合。 */
  private _fuseWeightedAverage(results: Array<Record<string, any>>): Record<string, any> {
    let totalWeight = 0.0
    let fusedConfidence = 0.0
    let fusedQuality = 0.0
    let fusedSecurity = 0.0

    // 取最高敏感度
    let maxSensitivity = 0
    const allEntities: Array<Record<string, string>> = []
    const allMetadata: Record<string, any> = {}

    // 合并文本
    const mergedTextParts: string[] = []

    for (const result of results) {
      const inputType = result.parsed_content?.input_type ?? 'text'
      const weight = this._weights[inputType] ?? 0.3

      const confidence = result.confidence ?? 0.0
      const quality = result.quality_score ?? 0.0
      const security = result.security_score ?? 1.0
      const sensitivity = result.metadata?.sensitivity_level ?? 0

      fusedConfidence += confidence * weight
      fusedQuality += quality * weight
      fusedSecurity += security * weight
      maxSensitivity = Math.max(maxSensitivity, sensitivity)
      totalWeight += weight

      // 合并文本
      const text = result.parsed_content?.text ?? ''
      if (text) {
        mergedTextParts.push(text)
      }

      // 合并实体
      const entities = result.entities ?? []
      allEntities.push(...entities)

      // 合并 metadata
      const meta = result.metadata ?? {}
      for (const [key, value] of Object.entries(meta)) {
        if (!(key in allMetadata)) {
          allMetadata[key] = value
        }
      }
    }

    if (totalWeight > 0) {
      fusedConfidence /= totalWeight
      fusedQuality /= totalWeight
      fusedSecurity /= totalWeight
    }

    return {
      parsed_content: {
        input_type: 'fused',
        text: mergedTextParts.join('\n'),
        modalities: results.map((r) => r.parsed_content?.input_type ?? 'text'),
      },
      detected_language: results[0].detected_language ?? null,
      confidence: Math.round(fusedConfidence * 1000) / 1000,
      metadata: {
        ...allMetadata,
        sensitivity_level: maxSensitivity,
        fusion_strategy: 'weighted_average',
        source_count: results.length,
      },
      quality_score: Math.round(fusedQuality * 1000) / 1000,
      security_score: Math.round(fusedSecurity * 1000) / 1000,
      entities: allEntities,
      intent: this._mergeIntent(results),
      sentiment: this._mergeSentiment(results),
      language_mixed: results.some((r) => r.language_mixed ?? false),
    }
  }

  /** 取置信度最高的结果。 */
  private _fuseMaxConfidence(results: Array<Record<string, any>>): Record<string, any> {
    let best = results[0]
    for (const r of results) {
      if ((r.confidence ?? 0.0) > (best.confidence ?? 0.0)) {
        best = r
      }
    }
    const bestCopy = { ...best }
    bestCopy.metadata = bestCopy.metadata ?? {}
    bestCopy.metadata['fusion_strategy'] = 'max_confidence'
    return bestCopy
  }

  /** 多数投票融合（主要用于敏感度等离散字段）。 */
  private _fuseVoting(results: Array<Record<string, any>>): Record<string, any> {
    // 敏感度投票
    const sensitivityVotes: Record<number, number> = {}
    for (const r of results) {
      const level = r.metadata?.sensitivity_level ?? 0
      sensitivityVotes[level] = (sensitivityVotes[level] ?? 0) + 1
    }

    let votedSensitivity = 0
    let maxVotes = 0
    for (const [level, votes] of Object.entries(sensitivityVotes)) {
      if (votes > maxVotes) {
        maxVotes = votes
        votedSensitivity = parseInt(level, 10)
      }
    }

    // 取置信度最高的作为基础
    let best = results[0]
    for (const r of results) {
      if ((r.confidence ?? 0.0) > (best.confidence ?? 0.0)) {
        best = r
      }
    }
    const bestCopy = { ...best }
    bestCopy.metadata = bestCopy.metadata ?? {}
    bestCopy.metadata['sensitivity_level'] = votedSensitivity
    bestCopy.metadata['fusion_strategy'] = 'voting'
    return bestCopy
  }

  /** 合并意图结果。 */
  private _mergeIntent(results: Array<Record<string, any>>): Record<string, number> | null {
    const merged: Record<string, number> = {}
    for (const r of results) {
      const intent = r.intent
      if (typeof intent === 'object' && intent !== null) {
        for (const [key, value] of Object.entries(intent)) {
          merged[key] = Math.max(merged[key] ?? 0.0, value as number)
        }
      } else if (typeof intent === 'string') {
        merged[intent] = (merged[intent] ?? 0.0) + 1.0 / results.length
      }
    }
    return Object.keys(merged).length > 0 ? merged : null
  }

  /** 合并情感结果。 */
  private _mergeSentiment(results: Array<Record<string, any>>): Record<string, number> | null {
    const merged: Record<string, number> = { positive: 0.0, negative: 0.0, neutral: 0.0 }
    let count = 0
    for (const r of results) {
      const sentiment = r.sentiment
      if (typeof sentiment === 'object' && sentiment !== null) {
        for (const key of Object.keys(merged)) {
          merged[key] += sentiment[key] ?? 0.0
        }
        count += 1
      }
    }
    if (count === 0) {
      return null
    }
    for (const key of Object.keys(merged)) {
      merged[key] = Math.round((merged[key] / count) * 1000) / 1000
    }
    return merged
  }

  private _emptyResult(): Record<string, any> {
    return {
      parsed_content: { input_type: 'empty', text: '' },
      detected_language: null,
      confidence: 0.0,
      metadata: { sensitivity_level: 0, fusion_strategy: 'none' },
      quality_score: 0.0,
      security_score: 1.0,
      entities: [],
      intent: null,
      sentiment: null,
    }
  }
}
