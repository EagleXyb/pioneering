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

import type { MarkdownDoc } from './markdown-loader.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[config.markdown_prompt] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[config.markdown_prompt] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[config.markdown_prompt] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[config.markdown_prompt] ${msg}`, ...args),
}

function sortedDocs(docs: MarkdownDoc[]): MarkdownDoc[] {
  return [...docs].sort((a, b) => {
    const pa = a.meta.priority ?? 0
    const pb = b.meta.priority ?? 0
    if (pa !== pb) return pb - pa
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
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
  static aggregateToSystemPrompt(base: string | null, docs: MarkdownDoc[]): string | null {
    const frags = sortedDocs(docs)
      .filter((d) => d.injectTo === 'system_prompt')
      .map((d) => d.content)

    if (frags.length === 0) {
      return base
    }
    const merged = (base || '') + '\n\n' + frags.join('\n\n')
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
  static collectRuntimeContext(docs: MarkdownDoc[]): string {
    const frags = sortedDocs(docs)
      .filter((d) => d.injectTo === 'runtime_context')
      .map((d) => d.content)

    if (frags.length === 0) {
      return ''
    }
    return frags.join('\n\n')
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
  ): { systemPrompt: string | null; runtimeContext: string } {
    const systemPrompt = MarkdownPromptAggregator.aggregateToSystemPrompt(base, docs)
    const runtimeContext = MarkdownPromptAggregator.collectRuntimeContext(docs)
    return { systemPrompt, runtimeContext }
  }
}
