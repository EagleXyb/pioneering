// Observation 多层蒸馏器（对应文档 P0-3：Observation 阶段多层信息蒸馏）
//
// 对工具返回结果进行三层蒸馏，控制 Token 消耗：
//   Layer-1: 结构化提取（status / records_count / key_metrics）
//   Layer-2: 相关性过滤（按 current_subtask 关键词过滤）
//   Layer-3: 增量压缩（与 history 去重，仅保留新信息）
//
// 设计要点：
//   1. 蒸馏器为纯函数模块，无副作用，便于单元测试
//   2. 蒸馏结果格式与现有 parsedContent 结构对齐（status/records_count/key_metrics）
//   3. 异常时降级返回原始内容，保证不阻断 ReAct 循环
//
// 风险控制（对应风险登记表 R-03）：
//   - 触及 makeToolResultProcessor（Observation 回写关键路径）
//   - 规避：feature flag + 异常降级 + 原始 content 保留为 raw 字段
//   - 蒸馏输出格式与现有 parsedContent 结构对齐

/**
 * 蒸馏后的 Observation 结构。
 *
 * 字段对齐现有 parsedContent，保证下游 LLM 感知一致。
 */
export interface DistilledObservation {
  /** 工具执行状态：success / error */
  status: string
  /** 记录数（列表型结果的条目数） */
  records_count?: number
  /** 关键指标（数值型结果摘要） */
  key_metrics?: Record<string, number | string>
  /** 摘要文本（蒸馏后的核心信息，控制在 maxTokens 以内） */
  summary: string
  /** 错误码（status=error 时存在） */
  error_code?: string
  /** 错误信息（status=error 时存在） */
  error_message?: string
  /** 原始结果保留（调试与回退用，不写入 ToolMessage content） */
  raw?: any
}

/**
 * Observation 蒸馏器。
 *
 * 三层管道：
 *   1. 结构化提取：从原始结果中提取 status/records_count/key_metrics
 *   2. 相关性过滤：按 current_subtask 关键词过滤无关字段
 *   3. 增量压缩：与 history 去重，仅保留新信息
 */
export class ObservationDistiller {
  /** 最大 token 预算（默认 500，可通过构造函数配置） */
  private readonly maxTokens: number
  /** 粗略 token 估算系数（1 token ≈ 4 字符，中英文混合取 3） */
  private readonly charsPerToken = 3

  constructor(maxTokens: number = 500) {
    this.maxTokens = maxTokens
  }

  /**
   * 蒸馏工具返回结果。
   *
   * @param rawObservation 原始工具返回（已解析的对象或字符串）
   * @param currentSubtask 当前子任务（用于相关性过滤，可为 null）
   * @param history 历史 Observation 列表（用于增量压缩去重）
   * @returns 蒸馏后的 Observation
   */
  distill(
    rawObservation: any,
    currentSubtask: Record<string, any> | null = null,
    history: Array<Record<string, any>> = [],
  ): DistilledObservation {
    // 异常输入降级：直接返回原始内容的字符串形式
    if (rawObservation === null || rawObservation === undefined) {
      return {
        status: 'success',
        summary: '',
        raw: rawObservation,
      }
    }

    try {
      // Layer-1: 结构化提取
      const structured = this._extractStructured(rawObservation)

      // Layer-2: 相关性过滤（current_subtask 缺失时跳过）
      const relevant = this._filterByRelevance(structured, currentSubtask)

      // Layer-3: 增量压缩（与 history 去重）
      const incremental = this._compressIncremental(relevant, history)

      // Token 预算控制
      const budgeted = this._applyTokenBudget(incremental)

      return budgeted
    } catch {
      // 蒸馏异常降级：返回原始内容的字符串形式
      const fallbackSummary = typeof rawObservation === 'string'
        ? rawObservation
        : JSON.stringify(rawObservation).slice(0, this.maxTokens * this.charsPerToken)
      return {
        status: 'success',
        summary: fallbackSummary,
        raw: rawObservation,
      }
    }
  }

  /**
   * Layer-1: 结构化提取。
   *
   * 从原始结果中提取 status / records_count / key_metrics / summary。
   * 兼容多种工具返回格式：
   *   - { status, data: [...] }
   *   - { status, data: { key: value } }
   *   - { status, result: ... }
   *   - 纯字符串 / 数字
   */
  private _extractStructured(raw: any): DistilledObservation {
    const result: DistilledObservation = {
      status: 'success',
      summary: '',
      raw,
    }

    // 字符串型结果
    if (typeof raw === 'string') {
      result.summary = raw
      return result
    }

    // 数字型结果
    if (typeof raw === 'number') {
      result.summary = String(raw)
      result.key_metrics = { value: raw }
      return result
    }

    // 对象型结果
    if (typeof raw === 'object' && raw !== null) {
      // status 字段
      const rawStatus = raw['status']
      result.status = rawStatus === 'error' || rawStatus === 'failed' ? 'error' : 'success'
      if (result.status === 'error') {
        result.error_code = raw['error_code'] ?? raw['code'] ?? 'UNKNOWN'
        result.error_message = raw['error_message'] ?? raw['message'] ?? raw['error'] ?? ''
      }

      // 提取 data / result / output 字段
      const dataField = raw['data'] ?? raw['result'] ?? raw['output'] ?? raw

      // records_count：列表型结果的条目数
      if (Array.isArray(dataField)) {
        result.records_count = dataField.length
        // 列表型结果：提取每条记录的关键字段
        result.summary = this._summarizeList(dataField)
        // key_metrics：列表统计
        result.key_metrics = this._extractListMetrics(dataField)
      } else if (typeof dataField === 'object' && dataField !== null) {
        // 对象型结果：提取所有键作为 key_metrics
        result.key_metrics = this._extractObjectMetrics(dataField)
        result.summary = this._summarizeObject(dataField)
      } else {
        // 标量型结果
        result.summary = String(dataField ?? '')
      }

      return result
    }

    // 其他类型
    result.summary = String(raw)
    return result
  }

  /**
   * Layer-2: 相关性过滤。
   *
   * 按 current_subtask 中的关键词过滤 summary，保留相关片段。
   * current_subtask 缺失时跳过过滤（返回原样）。
   */
  private _filterByRelevance(
    structured: DistilledObservation,
    currentSubtask: Record<string, any> | null,
  ): DistilledObservation {
    if (!currentSubtask) {
      return structured
    }

    // 提取 subtask 关键词（task_name / description / query 等）
    const subtaskText = [
      currentSubtask['task_name'],
      currentSubtask['description'],
      currentSubtask['query'],
      currentSubtask['intent'],
    ].filter((s) => typeof s === 'string' && s.length > 0).join(' ')

    if (!subtaskText) {
      return structured
    }

    // summary 按行分割，保留含关键词的行
    const keywords = this._extractKeywords(subtaskText)
    if (keywords.length === 0) {
      return structured
    }

    const lines = structured.summary.split('\n')
    const relevantLines = lines.filter((line) => {
      const lowerLine = line.toLowerCase()
      return keywords.some((kw) => lowerLine.includes(kw.toLowerCase()))
    })

    // 若过滤后行数过少（< 3），保留原 summary 避免信息丢失
    if (relevantLines.length < 3) {
      return structured
    }

    return {
      ...structured,
      summary: relevantLines.join('\n'),
    }
  }

  /**
   * Layer-3: 增量压缩。
   *
   * 与 history 中的 summary 去重，仅保留新信息。
   */
  private _compressIncremental(
    relevant: DistilledObservation,
    history: Array<Record<string, any>>,
  ): DistilledObservation {
    if (history.length === 0) {
      return relevant
    }

    // 收集历史 summary
    const historicalSummaries: string[] = []
    for (const h of history) {
      const summary = h['summary'] ?? h['result']?.['summary']
      if (typeof summary === 'string' && summary.length > 0) {
        historicalSummaries.push(summary)
      }
    }

    if (historicalSummaries.length === 0) {
      return relevant
    }

    // 简化去重：若当前 summary 与某历史 summary 相似度 > 80%，标记为重复
    // 实际生产可引入 embedding 相似度，此处用简单的子串/Jaccard 近似
    const currentLines = relevant.summary.split('\n').filter((l) => l.trim().length > 0)
    const newLines = currentLines.filter((line) => {
      const lowerLine = line.toLowerCase()
      // 若该行已出现在历史 summary 中，视为重复
      return !historicalSummaries.some((h) =>
        h.toLowerCase().includes(lowerLine) || lowerLine.includes(h.toLowerCase().slice(0, 50)),
      )
    })

    // 若新行过少（< 1），保留原 summary（避免信息全丢失）
    if (newLines.length === 0) {
      return {
        ...relevant,
        summary: `[duplicate of previous observation] ${relevant.summary.slice(0, 100)}`,
      }
    }

    return {
      ...relevant,
      summary: newLines.join('\n'),
    }
  }

  /**
   * Token 预算控制。
   *
   * 超过 maxTokens 时截断 summary，保留 key_metrics。
   */
  private _applyTokenBudget(obs: DistilledObservation): DistilledObservation {
    const maxChars = this.maxTokens * this.charsPerToken
    if (obs.summary.length <= maxChars) {
      return obs
    }

    return {
      ...obs,
      summary: obs.summary.slice(0, maxChars) + '\n... [truncated]',
    }
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private _summarizeList(items: any[]): string {
    if (items.length === 0) return '[]'
    // 列表型结果：展示前 5 条的关键字段
    const previews = items.slice(0, 5).map((item, idx) => {
      if (typeof item === 'string' || typeof item === 'number') {
        return `[${idx}] ${item}`
      }
      if (typeof item === 'object' && item !== null) {
        const keys = Object.keys(item).slice(0, 3)
        const kv = keys.map((k) => `${k}=${item[k]}`).join(', ')
        return `[${idx}] {${kv}}`
      }
      return `[${idx}] ${String(item)}`
    })
    const suffix = items.length > 5 ? `\n... (${items.length - 5} more items)` : ''
    return previews.join('\n') + suffix
  }

  private _summarizeObject(obj: Record<string, any>): string {
    const keys = Object.keys(obj).slice(0, 10)
    return keys.map((k) => {
      const v = obj[k]
      if (v === null || v === undefined) return `${k}: null`
      if (typeof v === 'object') return `${k}: [object]`
      return `${k}: ${String(v).slice(0, 100)}`
    }).join('\n')
  }

  private _extractListMetrics(items: any[]): Record<string, number | string> {
    const metrics: Record<string, number | string> = { count: items.length }
    // 提取数值型字段的最小/最大/均值（仅前 100 条）
    if (items.length > 0 && typeof items[0] === 'object' && items[0] !== null) {
      const numKeys = Object.keys(items[0]).filter((k) => typeof items[0][k] === 'number')
      for (const k of numKeys.slice(0, 3)) {
        const values = items.slice(0, 100).map((i) => Number(i[k])).filter((v) => !isNaN(v))
        if (values.length > 0) {
          metrics[`${k}_min`] = Math.min(...values)
          metrics[`${k}_max`] = Math.max(...values)
        }
      }
    }
    return metrics
  }

  private _extractObjectMetrics(obj: Record<string, any>): Record<string, number | string> {
    const metrics: Record<string, number | string> = {}
    for (const [k, v] of Object.entries(obj).slice(0, 10)) {
      if (typeof v === 'number' || typeof v === 'string') {
        metrics[k] = v
      }
    }
    return metrics
  }

  private _extractKeywords(text: string): string[] {
    // 简化分词：按空格与标点分割，过滤短词
    return text
      .split(/[\s,，。.;；:：!！?？()（）"'`']+/)
      .filter((w) => w.length >= 2)
      .slice(0, 10)
  }
}

/**
 * 将蒸馏结果格式化为 ToolMessage content 字符串。
 *
 * 格式与现有 parsedContent 结构对齐，下游 LLM 无需感知差异。
 */
export function formatDistilledAsContent(distilled: DistilledObservation): string {
  // error 状态保留原始 error 结构
  if (distilled.status === 'error') {
    return JSON.stringify({
      status: 'error',
      error_code: distilled.error_code ?? 'UNKNOWN',
      error_message: distilled.error_message ?? '',
      summary: distilled.summary,
    })
  }

  // success 状态输出蒸馏后的结构
  return JSON.stringify({
    status: 'success',
    records_count: distilled.records_count,
    key_metrics: distilled.key_metrics,
    data: distilled.summary,
  })
}
