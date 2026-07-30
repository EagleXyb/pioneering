// Observation 多层蒸馏器（对应文档 P0-3：Observation 阶段多层信息蒸馏）
//
// 对工具返回结果进行三层蒸馏，控制 Token 消耗：
//   Layer-1: 结构化提取（status / records_count / key_metrics）
//   Layer-2: 相关性过滤（按 current_subtask 关键词过滤）
//   Layer-3: 增量压缩（与 history 去重，仅保留新信息）
//
// P1-1 扩展：异常信号增强（对应文档 §1.3 策略 B 与风险登记表 R-05）
//   - 在蒸馏输出中追加 enhancement 文本，引导 LLM 调整策略
//   - 仅在 status==='error' 分支生效，不修改原始 error 结构
//   - enhancement 文本以 `⚠️` 前缀与 `---` 分隔符与原始 payload 隔离
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
  /**
   * 异常信号增强文本（P1-1，status=error 时可能存在）。
   *
   * 引导 LLM 在遇到工具异常时调整策略（如缩小查询范围、切换备用工具）。
   * 由 ERROR_PATTERNS 映射表匹配 error_code / error_message 生成，
   * 不修改原始 error 结构；格式化时以 `⚠️` 前缀与 `---` 分隔符与原始 payload 隔离。
   */
  enhancement?: string
  /** 原始结果保留（调试与回退用，不写入 ToolMessage content） */
  raw?: any
}

// ============================================================
// P1-1: 异常信号增强映射表（对应文档 §1.3 策略 B 与风险登记表 R-05）
// ============================================================

/**
 * 异常模式增强配置。
 *
 * - match: 命中条件（error_code 子串匹配，大小写不敏感）
 * - enhancement: 引导 LLM 调整策略的建议文本
 * - suggest_alternatives: 是否在 enhancement 中提示切换备用工具
 */
interface ErrorPatternConfig {
  /** error_code 子串匹配关键词（小写） */
  match: string[]
  /** 增强建议文本 */
  enhancement: string
  /** 是否提示切换备用工具 */
  suggest_alternatives?: boolean
}

/**
 * 异常模式 → 增强建议映射表。
 *
 * 设计要点：
 *   1. 仅覆盖常见可恢复异常（timeout / empty_result / permission_denied / data_quality_issue）
 *      未覆盖的异常码不影响主流程（enhancement 为空，等价原行为）
 *   2. enhancement 文本仅作为 prompt 引导，不修改原始 error payload
 *   3. 匹配基于 error_code 子串（大小写不敏感），兼容不同工具的命名约定
 */
export const ERROR_PATTERNS: ErrorPatternConfig[] = [
  {
    match: ['timeout', 'timed_out', 'timed out', 'gateway_timeout', 'etimedout'],
    enhancement:
      'Tool call timed out. Suggested actions: 1) narrow the query scope 2) switch to a fallback tool 3) split into smaller sub-queries.',
    suggest_alternatives: true,
  },
  {
    match: ['empty', 'no_results', 'not_found', 'null_result', 'empty_result'],
    enhancement:
      'Query returned empty results. Suggested actions: 1) broaden filter conditions 2) verify query parameters 3) try fuzzy search.',
  },
  {
    match: ['permission', 'forbidden', 'unauthorized', 'access_denied', '403', '401'],
    enhancement:
      'Permission denied. Suggested actions: 1) use an alternative tool accessible with current privileges 2) request privilege escalation.',
    suggest_alternatives: true,
  },
  {
    match: ['rate_limit', 'too_many_requests', '429', 'quota_exceeded'],
    enhancement:
      'Rate limit exceeded. Suggested actions: 1) wait and retry with backoff 2) reduce call frequency 3) cache previous results if applicable.',
  },
  {
    match: ['data_quality', 'invalid_data', 'schema_mismatch', 'parse_error'],
    enhancement:
      'Data quality issue detected. Suggested actions: 1) use a data cleaning tool 2) flag problematic fields 3) cross-validate with another source.',
  },
  {
    match: ['network', 'connection', 'econnreset', 'econnrefused', 'socket_hang_up'],
    enhancement:
      'Network error occurred. Suggested actions: 1) retry once with backoff 2) switch to offline cached data 3) inform user of temporary unavailability.',
    suggest_alternatives: true,
  },
]

/**
 * 默认的备用工具建议（suggest_alternatives=true 时附加）。
 *
 * 此处为通用建议，不绑定具体工具名，由 LLM 根据当前可用工具集自主选择。
 */
const _ALTERNATIVES_HINT =
  'If this tool remains unavailable, consider other tools in your toolset that can fulfill a similar purpose.'

/**
 * 根据 error_code 与 error_message 生成增强建议文本。
 *
 * 匹配策略：
 *   1. 优先按 error_code 子串匹配（大小写不敏感）
 *   2. 其次按 error_message 子串匹配
 *   3. 未命中任何模式时返回空字符串（等价原行为）
 *
 * @param errorCode 工具返回的 error_code
 * @param errorMessage 工具返回的 error_message
 * @returns 增强建议文本；未命中时为空字符串
 */
export function enhanceErrorSignal(
  errorCode?: string,
  errorMessage?: string,
): string {
  const code = (errorCode ?? '').toLowerCase()
  const msg = (errorMessage ?? '').toLowerCase()
  const haystack = `${code} ${msg}`

  for (const pattern of ERROR_PATTERNS) {
    const hit = pattern.match.some((kw) => haystack.includes(kw.toLowerCase()))
    if (!hit) continue

    const parts = [pattern.enhancement]
    if (pattern.suggest_alternatives) parts.push(_ALTERNATIVES_HINT)
    return parts.join(' ')
  }

  return ''
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
        // P1-1: 异常信号增强 —— 匹配 ERROR_PATTERNS 生成 enhancement 文本
        // 不修改原始 error 结构；enhancement 仅作为 prompt 引导
        const enhancement = enhanceErrorSignal(result.error_code, result.error_message)
        if (enhancement) {
          result.enhancement = enhancement
        }
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
 *
 * P1-1: error 分支追加 enhancement 字段（若存在），以 `⚠️` 前缀与 `---` 分隔符
 * 与原始 error payload 隔离，避免被下游误判为工具返回数据（对应风险 R-05 规避策略）。
 */
export function formatDistilledAsContent(distilled: DistilledObservation): string {
  // error 状态保留原始 error 结构
  if (distilled.status === 'error') {
    // P1-1: enhancement 非空时附加引导文本，与原始 error payload 隔离
    const payload: Record<string, any> = {
      status: 'error',
      error_code: distilled.error_code ?? 'UNKNOWN',
      error_message: distilled.error_message ?? '',
      summary: distilled.summary,
    }
    if (distilled.enhancement) {
      payload['enhancement'] = `⚠️ ${distilled.enhancement}`
      payload['enhancement_separator'] = '---'
    }
    return JSON.stringify(payload)
  }

  // success 状态输出蒸馏后的结构
  return JSON.stringify({
    status: 'success',
    records_count: distilled.records_count,
    key_metrics: distilled.key_metrics,
    data: distilled.summary,
  })
}
