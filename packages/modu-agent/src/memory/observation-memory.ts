// Observation 三级记忆管理（对应文档 P1-2：Observation 记忆管理）
//
// 维护 Agent 在多轮 TAO 循环中的 Observation 记忆，分为三级：
//   - short_term: 最近 N 轮的完整 Observation（默认 3 轮）
//   - working_memory: 关键事实的结构化存储（从被驱逐的 short_term 提取）
//   - long_term: 压缩后的历史摘要（每 5 轮惰性生成，不阻塞主循环）
//
// 设计要点：
//   1. ObservationMemory 作为不可变对象，通过 reducer 整体替换（非部分更新）
//      规避并发覆盖问题（对应风险 R-06 规避策略②）
//   2. long_term 摘要采用惰性生成（每 5 轮触发一次），不阻塞主循环
//      对应风险 R-06 规避策略①
//   3. memory context 控制在 500 tokens 以内，超出时优先保留 working_memory
//      对应风险 R-06 规避策略③
//   4. long_term 摘要复用 ModuLLM 接口，LLM 不可用时降级为规则化摘要
//
// 风险控制（对应风险登记表 R-06）：
//   - 触及 state.ts（新增 observation_memory 字段）+ agentNode（注入 SystemMessage）
//   - 规避：异步摘要 + reducer 整体替换 + token 预算
//   - 异常时降级返回空 context，不阻断 ReAct 循环

import type { ModuLLM, LLMMessage } from '../core/interfaces/llm.js'

/**
 * 单条 Observation 记忆条目。
 */
export interface ObservationEntry {
  /** 轮次编号（从 1 开始） */
  round: number
  /** 工具名 */
  tool?: string
  /** 执行状态：success / error */
  status?: string
  /** Observation 摘要（蒸馏后的精简版本） */
  observation: string
  /** 关键指标（可选） */
  key_metrics?: Record<string, number | string>
  /** 记录数（可选） */
  records_count?: number
  /** 异常增强建议（P1-1，error 时存在） */
  enhancement?: string
  /** 时间戳（毫秒） */
  timestamp: number
}

/**
 * 三级记忆容器。
 */
export interface MemoryStore {
  /** 短期记忆：最近 N 轮的完整 Observation */
  short_term: ObservationEntry[]
  /** 工作记忆：从被驱逐的 short_term 提取的关键事实 */
  working_memory: Record<string, any>
  /** 长期记忆：压缩后的历史摘要 */
  long_term: string[]
  /** 已处理的轮次总数 */
  total_rounds: number
  /** 上次生成 long_term 摘要的轮次（惰性触发用） */
  last_summary_round: number
}

/**
 * 记忆上下文（供 agentNode 注入 SystemMessage）。
 */
export interface MemoryContext {
  /** 近期详情（short_term） */
  recent_observations: ObservationEntry[]
  /** 全局关键事实（working_memory） */
  key_facts: Record<string, any>
  /** 历史摘要（long_term） */
  history_summary: string
}

/**
 * Observation 三级记忆管理器。
 *
 * 使用方式：
 *   - 每轮 Observation 后调用 `update(observation, roundNum)` 更新记忆
 *   - 在 agentNode 入口调用 `getContext()` 获取注入上下文
 *   - 通过 `serialize()` / `deserialize()` 实现 state 持久化
 *
 * 不可变语义：所有变更方法返回新的 ObservationMemory 实例，
 * 通过 state reducer 整体替换（对应风险 R-06 规避策略②）。
 */
export class ObservationMemory {
  /** 短期记忆保留轮数（默认 3） */
  private readonly shortTermSize: number
  /** long_term 摘要触发间隔（默认 5 轮） */
  private readonly summaryInterval: number
  /** context token 预算上限（默认 500 tokens） */
  private readonly maxContextTokens: number
  /** 粗略 token 估算系数（1 token ≈ 3 字符，中英文混合） */
  private readonly charsPerToken = 3
  /** LLM 实例（用于 long_term 摘要生成，null 时降级为规则化摘要） */
  private readonly llm: ModuLLM | null
  /** 内部记忆存储 */
  private store: MemoryStore

  constructor(options: {
    shortTermSize?: number
    summaryInterval?: number
    maxContextTokens?: number
    llm?: ModuLLM | null
    initial?: MemoryStore
  } = {}) {
    this.shortTermSize = options.shortTermSize ?? 3
    this.summaryInterval = options.summaryInterval ?? 5
    this.maxContextTokens = options.maxContextTokens ?? 500
    this.llm = options.llm ?? null
    this.store = options.initial ?? {
      short_term: [],
      working_memory: {},
      long_term: [],
      total_rounds: 0,
      last_summary_round: 0,
    }
  }

  /**
   * 更新记忆（每轮 Observation 后调用）。
   *
   * 不可变语义：返回新的 ObservationMemory 实例，原实例不变。
   *
   * @param entry 本轮 Observation 条目
   * @returns 更新后的新 ObservationMemory 实例
   */
  update(entry: ObservationEntry): ObservationMemory {
    const newStore: MemoryStore = {
      short_term: [...this.store.short_term, entry],
      working_memory: { ...this.store.working_memory },
      long_term: [...this.store.long_term],
      total_rounds: this.store.total_rounds + 1,
      last_summary_round: this.store.last_summary_round,
    }

    // 短期记忆超限时驱逐最旧条目，提取关键事实到 working_memory
    while (newStore.short_term.length > this.shortTermSize) {
      const evicted = newStore.short_term.shift()!
      this._extractToWorkingMemory(evicted, newStore.working_memory)
    }

    // 惰性触发 long_term 摘要生成（每 summaryInterval 轮一次）
    // 注意：此处仅标记需要生成，实际 LLM 调用在 summarizeLongTerm() 中异步执行
    // 避免阻塞主循环（对应风险 R-06 规避策略①）
    return new ObservationMemory({
      shortTermSize: this.shortTermSize,
      summaryInterval: this.summaryInterval,
      maxContextTokens: this.maxContextTokens,
      llm: this.llm,
      initial: newStore,
    })
  }

  /**
   * 获取上下文（供 agentNode 注入 SystemMessage）。
   *
   * 返回 recent_observations / key_facts / history_summary 三部分，
   * 总 token 控制在 maxContextTokens 以内，超出时优先保留 working_memory。
   */
  getContext(): MemoryContext {
    const recent = this.store.short_term
    const keyFacts = { ...this.store.working_memory }
    const historySummary = this.store.long_term.join('\n')

    // Token 预算控制：优先保留 working_memory，其次 recent，最后 history
    const keyFactsStr = this._formatKeyFacts(keyFacts)
    const recentStr = this._formatRecent(recent)
    const maxChars = this.maxContextTokens * this.charsPerToken

    let availableChars = maxChars - keyFactsStr.length
    let trimmedRecent = recentStr
    let trimmedHistory = historySummary

    if (availableChars < 0) {
      // working_memory 已超预算，截断 working_memory
      return {
        recent_observations: [],
        key_facts: this._truncateKeyFacts(keyFacts, maxChars),
        history_summary: '',
      }
    }

    if (recentStr.length > availableChars) {
      trimmedRecent = recentStr.slice(0, availableChars) + '\n... [truncated]'
      trimmedHistory = ''
    } else {
      availableChars -= recentStr.length
      if (historySummary.length > availableChars) {
        trimmedHistory = historySummary.slice(0, availableChars) + '\n... [truncated]'
      }
    }

    return {
      recent_observations: recent,
      key_facts: keyFacts,
      history_summary: trimmedHistory,
    }
  }

  /**
   * 异步生成 long_term 摘要（惰性触发）。
   *
   * 当 total_rounds - last_summary_round >= summaryInterval 时触发，
   * 将短期记忆中被驱逐的条目（已提取到 working_memory）压缩为摘要存入 long_term。
   *
   * LLM 不可用或调用失败时降级为规则化摘要（取每条 observation 前 100 字符）。
   *
   * @returns 更新后的新 ObservationMemory 实例；未到触发间隔时返回原实例
   */
  async summarizeLongTerm(): Promise<ObservationMemory> {
    const roundsSinceLastSummary =
      this.store.total_rounds - this.store.last_summary_round
    if (roundsSinceLastSummary < this.summaryInterval) {
      return this
    }

    // 收集待摘要的条目（short_term 之外的已驱逐条目无法直接获取，
    // 此处用 working_memory 中的关键事实 + 当前 short_term 生成摘要）
    const factsToSummarize = Object.entries(this.store.working_memory)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join('\n')

    if (!factsToSummarize) {
      // 无可摘要内容，仅更新 last_summary_round
      return new ObservationMemory({
        shortTermSize: this.shortTermSize,
        summaryInterval: this.summaryInterval,
        maxContextTokens: this.maxContextTokens,
        llm: this.llm,
        initial: {
          ...this.store,
          last_summary_round: this.store.total_rounds,
        },
      })
    }

    let summary: string
    try {
      if (this.llm) {
        summary = await this._generateLlmSummary(factsToSummarize)
      } else {
        summary = this._generateRuleSummary(factsToSummarize)
      }
    } catch (e: any) {
      // LLM 摘要失败，降级为规则化摘要
      summary = this._generateRuleSummary(factsToSummarize)
    }

    return new ObservationMemory({
      shortTermSize: this.shortTermSize,
      summaryInterval: this.summaryInterval,
      maxContextTokens: this.maxContextTokens,
      llm: this.llm,
      initial: {
        ...this.store,
        long_term: [...this.store.long_term, summary],
        // 摘要生成后清空 working_memory（已压缩到 long_term）
        working_memory: {},
        last_summary_round: this.store.total_rounds,
      },
    })
  }

  /**
   * 序列化为可持久化的 MemoryStore。
   */
  serialize(): MemoryStore {
    // 深拷贝避免外部修改影响内部状态
    return {
      short_term: this.store.short_term.map((e) => ({ ...e })),
      working_memory: { ...this.store.working_memory },
      long_term: [...this.store.long_term],
      total_rounds: this.store.total_rounds,
      last_summary_round: this.store.last_summary_round,
    }
  }

  /**
   * 从 MemoryStore 反序列化。
   */
  static deserialize(store: MemoryStore, llm: ModuLLM | null = null): ObservationMemory {
    return new ObservationMemory({ initial: store, llm })
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 从被驱逐的 short_term 条目提取关键事实到 working_memory。
   *
   * 提取规则：
   *   - tool + status 作为 key，observation 摘要作为 value
   *   - key_metrics 中的数值字段单独提取
   */
  private _extractToWorkingMemory(
    evicted: ObservationEntry,
    workingMemory: Record<string, any>,
  ): void {
    const key = `${evicted.tool ?? 'unknown'}_round${evicted.round}`
    workingMemory[key] = {
      status: evicted.status ?? 'success',
      summary: evicted.observation.slice(0, 200),
      records_count: evicted.records_count,
    }

    // 提取 key_metrics 中的数值字段
    if (evicted.key_metrics) {
      for (const [k, v] of Object.entries(evicted.key_metrics)) {
        if (typeof v === 'number') {
          workingMemory[`${evicted.tool ?? 'unknown'}_${k}`] = v
        }
      }
    }
  }

  /**
   * 使用 LLM 生成历史摘要。
   */
  private async _generateLlmSummary(facts: string): Promise<string> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content:
          'You are an observation summarizer. Compress the following key facts into a concise summary (max 200 chars). Output only the summary text.',
      },
      { role: 'user', content: facts },
    ]

    const result = await this.llm!.invoke(messages, {
      temperature: 0.0,
      maxTokens: 100,
    })
    return result.content.trim().slice(0, 200)
  }

  /**
   * 规则化摘要（LLM 不可用时的降级路径）。
   *
   * 取每条事实的前 50 字符，拼接为摘要。
   */
  private _generateRuleSummary(facts: string): string {
    const lines = facts.split('\n').filter((l) => l.trim().length > 0)
    const summary = lines
      .slice(0, 5)
      .map((l) => l.slice(0, 50))
      .join(' | ')
    return summary.slice(0, 200)
  }

  /**
   * 格式化 recent_observations 为字符串。
   */
  private _formatRecent(entries: ObservationEntry[]): string {
    if (entries.length === 0) return ''
    return entries
      .map(
        (e) =>
          `[${e.round}] ${e.tool ?? 'unknown'} (${e.status ?? 'success'}): ${e.observation}`,
      )
      .join('\n')
  }

  /**
   * 格式化 key_facts 为字符串。
   */
  private _formatKeyFacts(facts: Record<string, any>): string {
    const keys = Object.keys(facts)
    if (keys.length === 0) return ''
    return keys
      .map((k) => {
        const v = facts[k]
        const vStr = typeof v === 'object' ? JSON.stringify(v) : String(v)
        return `${k}: ${vStr}`
      })
      .join('\n')
  }

  /**
   * 截断 key_facts 以适应 token 预算。
   */
  private _truncateKeyFacts(
    facts: Record<string, any>,
    maxChars: number,
  ): Record<string, any> {
    const result: Record<string, any> = {}
    let used = 0
    for (const [k, v] of Object.entries(facts)) {
      const entry = `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}\n`
      if (used + entry.length > maxChars) break
      result[k] = v
      used += entry.length
    }
    return result
  }
}

/**
 * 创建空记忆（state 初始化用）。
 */
export function createEmptyMemory(): MemoryStore {
  return {
    short_term: [],
    working_memory: {},
    long_term: [],
    total_rounds: 0,
    last_summary_round: 0,
  }
}

/**
 * 将 MemoryContext 格式化为 SystemMessage content 字符串。
 *
 * 供 agentNode 注入 SystemMessage 使用，格式：
 *   ```
 *   Observation memory context:
 *   [Recent]
 *   [1] search_engine (success): ...
 *   [Key Facts]
 *   search_engine_count: 5
 *   [History Summary]
 *   ...
 *   ```
 */
export function formatMemoryContextAsContent(ctx: MemoryContext): string {
  const parts: string[] = ['Observation memory context:']

  if (ctx.recent_observations.length > 0) {
    parts.push('[Recent]')
    for (const e of ctx.recent_observations) {
      parts.push(
        `[${e.round}] ${e.tool ?? 'unknown'} (${e.status ?? 'success'}): ${e.observation}`,
      )
    }
  }

  if (Object.keys(ctx.key_facts).length > 0) {
    parts.push('[Key Facts]')
    for (const [k, v] of Object.entries(ctx.key_facts)) {
      const vStr = typeof v === 'object' ? JSON.stringify(v) : String(v)
      parts.push(`${k}: ${vStr}`)
    }
  }

  if (ctx.history_summary) {
    parts.push('[History Summary]')
    parts.push(ctx.history_summary)
  }

  return parts.join('\n')
}
