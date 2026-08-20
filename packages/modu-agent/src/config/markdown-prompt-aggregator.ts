// markdown-prompt-aggregator.ts
//
// P1（文档 4.3 / 4.4-P1）落地项：Markdown 提示聚合器。
//
// 沿用 SkillPromptAggregator 的聚合模式：把加载到的 Markdown 配置文档片段，
// 按注入目标（inject_to）分别并入 system_prompt 与 runtime_context。
//
// 设计约束（严守"不修改原有业务逻辑、不引入新缺陷"）：
//   - 无任何 Markdown 文档时，aggregate 返回 base 原样（行为等价现状）。
//   - 纯函数 + 无副作用，便于单元测试。
//   - 按 priority 排序（数值大者在前），再按文档名稳定排序，保证确定性。

import type { MarkdownDoc, CascadeLevel } from './markdown-loader.js'
import { CASCADE_LEVEL_ORDER } from './markdown-loader.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[config.markdown_prompt] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[config.markdown_prompt] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[config.markdown_prompt] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[config.markdown_prompt] ${msg}`, ...args),
}

/**
 * 按层级 cascade 排序文档（4.5 风险①「AGENTS.md 分层级 cascade」）：
 *   1. cascade 级别小的（global < project < user）在前（底层级联，上层追加）；
 *   2. 同级别内按 priority 数值大者在前；
 *   3. 再按文档名稳定排序，保证确定性。
 */
function sortedDocs(docs: MarkdownDoc[]): MarkdownDoc[] {
  const levelOrder = (lvl?: CascadeLevel): number => {
    if (!lvl) return CASCADE_LEVEL_ORDER.length
    const idx = CASCADE_LEVEL_ORDER.indexOf(lvl)
    return idx === -1 ? CASCADE_LEVEL_ORDER.length : idx
  }
  return [...docs].sort((a, b) => {
    const la = levelOrder(a.meta.cascade_level)
    const lb = levelOrder(b.meta.cascade_level)
    if (la !== lb) return la - lb
    const pa = a.meta.priority ?? 0
    const pb = b.meta.priority ?? 0
    if (pa !== pb) return pb - pa
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

/**
 * 长度预算配置（对应文档 4.5 风险①「Token 膨胀」）。
 * 对注入 system prompt / runtime context 的 Markdown 内容做字符级截断，
 * 避免 AGENTS.md/MEMORY.md 过大时撑爆 LLM 上下文。
 */
export interface MarkdownBudget {
  /** 注入 system prompt 的内容总字符上限；<=0 表示不限制 */
  systemPromptMaxChars: number
  /** 注入 runtime context 的内容总字符上限；<=0 表示不限制 */
  runtimeContextMaxChars: number
  /** 截断时追加的标记 */
  truncateMarker: string
}

export const DEFAULT_MARKDOWN_BUDGET: MarkdownBudget = {
  systemPromptMaxChars: 8000,
  runtimeContextMaxChars: 4000,
  truncateMarker: '\n\n[truncated]',
}

/**
 * 按字符预算截断字符串：超过上限时保留前 maxChars 个字符并追加标记。
 * maxChars <= 0 时原样返回（不限制）。
 */
function applyCharBudget(text: string, maxChars: number, marker: string): string {
  if (maxChars <= 0 || text.length <= maxChars) return text
  return text.slice(0, maxChars) + marker
}

/**
 * 估算字符串 token 数（粗略：4 字符 = 1 token），与 few-shot-selector 保持一致。
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export class MarkdownPromptAggregator {
  /**
   * 把 Markdown 文档片段聚合到 system prompt 的 system 层。
   *
   * 仅聚合 injectTo === 'system_prompt' 的文档（AGENTS/SOUL 等）。
   * 无相关文档时返回 base 原样。
   *
   * @param base 原始 system prompt（可能为 null）
   * @param docs 已加载的 Markdown 文档列表
   * @returns 合并后的提示；无片段则返回 base
   */
  static aggregateToSystemPrompt(
    base: string | null,
    docs: MarkdownDoc[],
    budget: MarkdownBudget = DEFAULT_MARKDOWN_BUDGET,
  ): string | null {
    const frags = sortedDocs(docs)
      .filter((d) => d.injectTo === 'system_prompt' && d.meta.cascade !== false)
      .map((d) => d.content)

    if (frags.length === 0) {
      return base
    }
    let injected = frags.join('\n\n')
    // 对注入片段做字符预算截断（4.5 风险① Token 膨胀）
    injected = applyCharBudget(injected, budget.systemPromptMaxChars, budget.truncateMarker)
    const merged = (base || '') + '\n\n' + injected
    return merged
  }

  /**
   * 收集 Markdown 文档片段作为 runtime_context（USER/MEMORY 等）。
   *
   * 仅收集 injectTo === 'runtime_context' 的文档，返回拼接后的字符串。
   * 无相关文档时返回空字符串（与"未提供 runtimeContext"等价）。
   *
   * @param docs 已加载的 Markdown 文档列表
   * @returns 聚合后的 runtime context 字符串
   */
  static collectRuntimeContext(
    docs: MarkdownDoc[],
    budget: MarkdownBudget = DEFAULT_MARKDOWN_BUDGET,
  ): string {
    const frags = sortedDocs(docs)
      .filter((d) => d.injectTo === 'runtime_context' && d.meta.cascade !== false)
      .map((d) => d.content)

    if (frags.length === 0) {
      return ''
    }
    const joined = frags.join('\n\n')
    // 对运行时上下文做字符预算截断（4.5 风险① Token 膨胀）
    return applyCharBudget(joined, budget.runtimeContextMaxChars, budget.truncateMarker)
  }

  /**
   * 便捷入口：加载项目根目录的约定 `.md` 文档并分别返回聚合结果。
   *
   * @param opts.rootDir 项目根目录（默认 getPackageRoot()）
   * @param opts.onlyEager 是否仅加载 load=eager 的文档（默认 false，加载全部）
   * @returns { systemPrompt: string|null, runtimeContext: string }
   *          - systemPrompt：base 已被 system_prompt 类文档聚合
   *          - runtimeContext：runtime_context 类文档聚合串（可能为空串）
   */
  static aggregateFromDocs(
    base: string | null,
    docs: MarkdownDoc[],
    budget: MarkdownBudget = DEFAULT_MARKDOWN_BUDGET,
  ): { systemPrompt: string | null; runtimeContext: string } {
    const systemPrompt = MarkdownPromptAggregator.aggregateToSystemPrompt(base, docs, budget)
    const runtimeContext = MarkdownPromptAggregator.collectRuntimeContext(docs, budget)
    return { systemPrompt, runtimeContext }
  }
}
