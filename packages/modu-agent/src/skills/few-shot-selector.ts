// P2-2: Few-shot 动态示例选择（对应文档 §1.2 优化点 11 + §5.3 P2-2）
//
// 设计要点（对应风险 R-11 规避策略）：
//   1. DynamicFewShotSelector 实现 MMR 算法（lambda=0.7），token 预算 1500
//   2. 示例库初始为空时静默跳过，不影响现有流程
//   3. 示例入库前需 quality_score 评分，低于 0.7 不入库
//   4. examples 作为 taskSpec 层注入 PromptComposer（依赖 P1-4）
//   5. feature flag enable_few_shot 默认 false
//
// 接入位置：
//   agentNode 中 Observation 历史注入后（行 709 之后），作为 SystemMessage 注入
//
// 示例库存储：
//   复用 ChromaLongTermMemory（userId='few_shot_examples' 隔离 namespace）
//   也支持纯内存示例库（InMemoryExampleStore）用于测试与轻量场景

import { getConfig } from '../config/runtime-config.js'

/** 轨迹中的单轮消息（Agent 示例优先使用轨迹，而非单轮问答）。 */
export interface FewShotTurn {
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** assistant 轮可选：工具调用（name + arguments）。 */
  tool_calls?: Array<{ name: string; arguments?: Record<string, unknown> }>
}

/**
 * Few-shot 示例结构（对应文档 EXAMPLE_SCHEMA）。
 */
export interface FewShotExample {
  /** 示例 ID（用于去重与追踪） */
  id: string
  /** 用户输入（问题描述） */
  input: string
  /** 期望输出（推理过程 + 最终答案） */
  output: string
  /** 领域标签（如 'research' / 'coding' / 'default'） */
  domain?: string
  /** 复杂度标签（如 'tier_1' / 'tier_2' / 'tier_3'） */
  complexity?: string
  /** 推理模式标签（如 'react' / 'plan_execute' / 'direct'） */
  pattern?: string
  /** 质量评分（0-1，低于 min_quality_score 不入库/不检索） */
  quality_score: number
  /** 创建时间戳（ms） */
  created_at?: number
  /** 来源（治理用：人工 / 线上反馈 / 失败修复）。 */
  source?: 'manual' | 'feedback' | 'repair'
  /** 示例版本（治理用）。 */
  version?: string
  /**
   * 可选轨迹：`user → assistant(tool_calls) → tool → assistant(final)`。
   * 存在时优先按轨迹格式化，教"过程"而不只是"答案"。
   */
  trajectory?: FewShotTurn[]
}

/**
 * 示例库接口（抽象）。
 *
 * 支持两种实现：
 *   - InMemoryExampleStore：纯内存，用于测试与轻量场景
 *   - ChromaExampleStore：复用 ChromaLongTermMemory，用于生产环境
 */
export interface ExampleStore {
  /** 检索与 query 相关的示例（按相关性降序） */
  search(query: string, limit: number): Promise<FewShotExample[]>
  /** 添加示例到库中 */
  add(example: FewShotExample): Promise<boolean>
  /** 获取库中示例总数 */
  count(): Promise<number>
}

/** CJK 字符范围（中日韩统一表意文字 + 假名 + 谚文）。 */
const _CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/

/**
 * 估算字符串 token 数（P1 / FS-5）。
 *
 * 旧实现统一按 `ceil(len/4)`，对中文低估约 4 倍；此处按 CJK 1 字 ≈ 1 token、
 * 其余 4 字符 ≈ 1 token 估算，误差显著更小（不引入 tokenizer 依赖）。
 */
export function estimateTokensCjk(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (_CJK_RE.test(ch)) cjk += 1
    else other += 1
  }
  return Math.ceil(cjk + other / 4)
}

/**
 * 轻量分词（P1 / FS-5）：ASCII 单词 + CJK bigram。
 *
 * 中文没有空格，旧实现 `split(/\s+/)` 会把整句当成一个 term，只能命中完全子串。
 * 这里用 bigram 近似，既无第三方依赖，又能覆盖"对比 / 方案 / 优缺点"这类词。
 */
export function tokenizeForMatch(text: string): string[] {
  if (!text) return []
  const lower = String(text).toLowerCase()
  const tokens: string[] = []
  for (const m of lower.matchAll(/[a-z0-9_]+/g)) {
    if (m[0].length > 1) tokens.push(m[0])
  }
  const cjkSegments = lower.match(/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]+/g) ?? []
  for (const seg of cjkSegments) {
    if (seg.length === 1) {
      tokens.push(seg)
      continue
    }
    for (let i = 0; i < seg.length - 1; i += 1) {
      tokens.push(seg.slice(i, i + 2))
    }
  }
  return tokens
}

/**
 * 纯内存示例库实现。
 *
 * 使用 CJK bigram + ASCII 词匹配作为相关性评分（无语义嵌入依赖）。
 * 生产环境建议替换为 ChromaExampleStore（语义嵌入检索）。
 *
 * P2（FS-8）治理：
 *   - 按 `input` 归一化去重，重复时保留质量分更高者；
 *   - 支持 TTL（`maxAgeDays`），过期示例在检索与写入时被忽略；
 *   - 记录来源/版本，便于审计与回滚。
 */
export class InMemoryExampleStore implements ExampleStore {
  private _examples: FewShotExample[] = []
  private _maxAgeDays: number | null

  constructor(
    initial: FewShotExample[] = [],
    options: { maxAgeDays?: number | null } = {},
  ) {
    this._examples = [...initial]
    this._maxAgeDays = options.maxAgeDays ?? null
  }

  private _isExpired(example: FewShotExample, now = Date.now()): boolean {
    if (this._maxAgeDays === null || this._maxAgeDays <= 0) return false
    const created = example.created_at ?? 0
    if (created <= 0) return false
    return now - created > this._maxAgeDays * 24 * 60 * 60 * 1000
  }

  private _dedupeKey(example: FewShotExample): string {
    return String(example.input ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  }

  async search(query: string, limit: number): Promise<FewShotExample[]> {
    // 空查询不返回示例，避免把"随机示例"注入到无关请求
    if (!query || query.trim() === '' || limit <= 0) return []
    const alive = this._examples.filter((ex) => !this._isExpired(ex))
    if (alive.length === 0) return []

    const queryLower = query.toLowerCase()
    const queryTerms = tokenizeForMatch(query)
    const querySet = new Set(queryTerms)

    const scored = alive.map((ex) => {
      const exampleTerms = tokenizeForMatch(ex.input)
      let overlap = 0
      for (const t of exampleTerms) {
        if (querySet.has(t)) overlap += 1
      }
      const norm = overlap / Math.max(querySet.size, 1)
      // 整体包含加分（短查询命中）
      const bonus = queryLower && ex.input.toLowerCase().includes(queryLower) ? 0.5 : 0
      return { example: ex, score: norm + bonus }
    })

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.example)
  }

  async add(example: FewShotExample): Promise<boolean> {
    if (this._isExpired(example)) return false
    const key = this._dedupeKey(example)
    if (!key) return false

    const existingIdx = this._examples.findIndex((ex) => this._dedupeKey(ex) === key)
    if (existingIdx >= 0) {
      // 去重：同输入只保留质量分更高的一条
      if (this._examples[existingIdx].quality_score >= example.quality_score) return false
      this._examples[existingIdx] = example
      return true
    }

    this._examples.push(example)
    return true
  }

  async count(): Promise<number> {
    return this._examples.filter((ex) => !this._isExpired(ex)).length
  }
}

/** 内部别名：统一使用 CJK 感知估算。 */
function _estimateTokens(text: string): number {
  return estimateTokensCjk(text)
}

/**
 * 格式化示例为 prompt 文本。
 *
 * 有 `trajectory` 时按对话轨迹输出（教过程），否则回退到输入/输出对。
 */
export function formatExample(example: FewShotExample): string {
  if (Array.isArray(example.trajectory) && example.trajectory.length > 0) {
    const lines: string[] = [`输入：${example.input}`, '轨迹：']
    for (const turn of example.trajectory) {
      const role = turn.role === 'assistant' ? '助手' : turn.role === 'tool' ? '工具' : '用户'
      lines.push(`  [${role}] ${turn.content}`)
      if (Array.isArray(turn.tool_calls) && turn.tool_calls.length > 0) {
        for (const call of turn.tool_calls) {
          const args = call.arguments ? JSON.stringify(call.arguments) : '{}'
          lines.push(`    调工具 ${call.name} 参数 ${args}`)
        }
      }
    }
    return lines.join('\n')
  }
  const parts: string[] = []
  parts.push(`输入：${example.input}`)
  parts.push(`输出：${example.output}`)
  return parts.join('\n')
}

/**
 * 格式化多个示例为 prompt 片段。
 */
export function formatExamplesAsPrompt(examples: FewShotExample[]): string {
  if (examples.length === 0) return ''
  const blocks = examples.map((ex, idx) => {
    return `### 示例 ${idx + 1}\n${formatExample(ex)}`
  })
  return `以下是一些参考示例：\n\n${blocks.join('\n\n---\n\n')}`
}

/**
 * MMR（Maximal Marginal Relevance）选择算法。
 *
 * 在已检索的候选示例中，平衡相关性与多样性，选出最终注入的示例子集。
 *
 * 公式：MMR = λ * rel(query, d) - (1-λ) * max_{d' in selected} sim(d, d')
 *   - λ=1.0：纯相关性（退化为 top-k）
 *   - λ=0.0：纯多样性
 *   - 默认 λ=0.7（偏相关性）
 *
 * @param query 用户查询
 * @param candidates 候选示例（已按相关性降序排列）
 * @param maxExamples 最多选择的示例数
 * @param lambda MMR 权重（默认 0.7）
 * @returns 选中的示例子集
 */
export function mmrSelect(
  query: string,
  candidates: FewShotExample[],
  maxExamples: number,
  lambda: number = 0.7,
): FewShotExample[] {
  if (candidates.length === 0) return []
  if (candidates.length <= maxExamples) return [...candidates]

  const queryLower = query.toLowerCase()
  const queryTerms = tokenizeForMatch(query)
  const querySet = new Set(queryTerms)

  // 计算示例与 query 的相关性（CJK bigram + ASCII 词）
  const relevanceScores = candidates.map((ex) => {
    const inputLower = ex.input.toLowerCase()
    let score = 0
    for (const term of tokenizeForMatch(ex.input)) {
      if (querySet.has(term)) score += 1
    }
    if (queryLower && inputLower.includes(queryLower)) score += 2
    return score / Math.max(querySet.size + 2, 1) // 归一化到 0-1
  })

  // 计算示例间相似度（基于输入文本的 token 重叠）
  const simMatrix: number[][] = candidates.map((a) =>
    candidates.map((b) => {
      if (a.id === b.id) return 1.0
      const aTerms = new Set(tokenizeForMatch(a.input))
      const bTerms = new Set(tokenizeForMatch(b.input))
      let overlap = 0
      for (const t of aTerms) {
        if (bTerms.has(t)) overlap += 1
      }
      return overlap / Math.max(aTerms.size, bTerms.size)
    }),
  )

  const selected: number[] = []
  const remaining = candidates.map((_, i) => i)

  while (selected.length < maxExamples && remaining.length > 0) {
    let bestIdx = -1
    let bestScore = -Infinity

    for (const idx of remaining) {
      const rel = relevanceScores[idx]
      let maxSim = 0
      for (const selIdx of selected) {
        maxSim = Math.max(maxSim, simMatrix[idx][selIdx])
      }
      const mmrScore = lambda * rel - (1 - lambda) * maxSim
      if (mmrScore > bestScore) {
        bestScore = mmrScore
        bestIdx = idx
      }
    }

    if (bestIdx < 0) break
    selected.push(bestIdx)
    const remIdx = remaining.indexOf(bestIdx)
    if (remIdx >= 0) remaining.splice(remIdx, 1)
  }

  return selected.map((i) => candidates[i])
}

/**
 * DynamicFewShotSelector：动态示例选择器。
 *
 * 从示例库检索 → MMR 去重 → token 预算截断 → 格式化为 prompt 片段。
 *
 * 使用方式：
 * ```ts
 * const selector = new DynamicFewShotSelector(store)
 * const promptFragment = await selector.selectAndFormat('用户查询文本')
 * if (promptFragment) {
 *   messages.push(new SystemMessage({ content: promptFragment }))
 * }
 * ```
 */
export class DynamicFewShotSelector {
  private _store: ExampleStore
  private _maxExamples: number
  private _maxTokensBudget: number
  private _minQualityScore: number
  private _mmrLambda: number

  constructor(
    store: ExampleStore,
    options: {
      maxExamples?: number
      maxTokensBudget?: number
      minQualityScore?: number
      mmrLambda?: number
    } = {},
  ) {
    this._store = store
    this._maxExamples = options.maxExamples ?? 3
    this._maxTokensBudget = options.maxTokensBudget ?? 1500
    this._minQualityScore = options.minQualityScore ?? 0.7
    this._mmrLambda = options.mmrLambda ?? 0.7
  }

  /**
   * 从配置创建选择器实例。
   *
   * @param store 示例库实例
   * @returns 选择器实例；配置未启用时返回 null
   */
  static fromConfig(store: ExampleStore): DynamicFewShotSelector | null {
    try {
      const cfg = getConfig()
      const enabled = cfg.get('react_optimization.few_shot.enabled', false)
      if (!enabled) return null

      return new DynamicFewShotSelector(store, {
        maxExamples: cfg.get('react_optimization.few_shot.max_examples', 3),
        maxTokensBudget: cfg.get('react_optimization.few_shot.max_tokens_budget', 1500),
        minQualityScore: cfg.get('react_optimization.few_shot.min_quality_score', 0.7),
        mmrLambda: cfg.get('react_optimization.few_shot.mmr_lambda', 0.7),
      })
    } catch {
      return null
    }
  }

  /**
   * 检索并选择示例。
   *
   * 流程：
   *   1. 从 store 检索 top-N 候选（N = maxExamples * 3，留余量给 MMR）
   *   2. 过滤 quality_score < minQualityScore 的示例
   *   3. MMR 选择 maxExamples 个示例
   *   4. 按 token 预算截断
   *
   * @param query 用户查询文本
   * @returns 选中的示例列表；store 为空时返回空数组
   */
  async select(query: string): Promise<FewShotExample[]> {
    // 检索候选（多检索一些供 MMR 选择）
    const candidates = await this._store.search(query, this._maxExamples * 3)

    // 空库静默跳过（R-11 策略①）
    if (candidates.length === 0) return []

    // 过滤低质量示例（R-11 策略③）
    const qualified = candidates.filter(
      (ex) => ex.quality_score >= this._minQualityScore,
    )
    if (qualified.length === 0) return []

    // MMR 选择
    const selected = mmrSelect(query, qualified, this._maxExamples, this._mmrLambda)

    // token 预算截断（R-11 策略②）
    const result: FewShotExample[] = []
    let tokenSum = 0
    for (const ex of selected) {
      const exTokens = _estimateTokens(formatExample(ex))
      if (tokenSum + exTokens > this._maxTokensBudget) break
      result.push(ex)
      tokenSum += exTokens
    }

    return result
  }

  /**
   * 检索、选择并格式化为 prompt 片段。
   *
   * @param query 用户查询文本
   * @returns prompt 片段；无可用示例时返回空字符串
   */
  async selectAndFormat(query: string): Promise<string> {
    const examples = await this.select(query)
    return formatExamplesAsPrompt(examples)
  }

  /**
   * 添加示例到库中（带质量门槛校验）。
   *
   * @param example 待添加的示例
   * @returns 是否添加成功（quality_score < minQualityScore 时返回 false）
   */
  async addExample(example: FewShotExample): Promise<boolean> {
    if (example.quality_score < this._minQualityScore) {
      return false
    }
    // P2（FS-8）：补齐治理字段，保证可追溯与可回滚。
    return this._store.add({
      ...example,
      created_at: example.created_at ?? Date.now(),
      source: example.source ?? 'manual',
      version: example.version ?? '1',
    })
  }
}
