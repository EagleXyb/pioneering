// 对应 Python: skills/prompt_aggregator.py
// Skill 提示聚合器（P2）。
//
// 把当前已注册的所有 Skill 提示片段合并为一段注入 LLM 的 system prompt 补充。
// 无激活 Skill 时返回原始 base 提示，行为等价于改造前。
//
// P0（选择→执行）：新增 opts.only —— 只聚合被选中的技能；
// P1-c（渐进式披露）：新增 opts.catalogOnly —— 只注入技能目录（name + 摘要）。
// 两个选项缺省时行为与改造前**逐字符等价**。
import type { ComponentRegistry } from '../core/registry.js'
import { SkillAdapter } from './adapter.js'
import { summarizeSkillDescription, type SkillCatalogEntry } from './selection.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[skills.prompt_aggregator] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[skills.prompt_aggregator] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[skills.prompt_aggregator] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[skills.prompt_aggregator] ${msg}`, ...args),
}

/** 目录注入的默认字符预算（P1-c）。 */
export const DEFAULT_SKILL_CATALOG_MAX_CHARS = 2000

/** 聚合选项。 */
export interface SkillAggregateOptions {
  /**
   * 仅聚合这些技能（按给定顺序）。
   * - `undefined`：全部已注册技能（改造前行为）
   * - `[]`：不注入任何技能片段（返回 base 原样）
   */
  only?: string[]
  /** 只注入「技能目录」，不注入正文与 examples（P1-c，默认 false） */
  catalogOnly?: boolean
  /** 目录注入字符预算（仅 catalogOnly 生效，默认 2000） */
  catalogMaxChars?: number
}

export class SkillPromptAggregator {
  /**
   * 合并 base 提示与 Skill 提示片段。
   *
   * @param base 原始 system prompt（可能为 null）
   * @param registry 组件注册中心
   * @param opts 选择 / 目录模式选项（缺省 = 改造前行为）
   * @returns 合并后的提示；若无任何 Skill 片段则返回 base（原样）。
   */
  static aggregate(
    base: string | null,
    registry: ComponentRegistry,
    opts?: SkillAggregateOptions,
  ): string | null {
    const only = opts?.only
    // only=[] 且非目录模式：明确不使用技能 → 不产生任何片段（但 catalog 模式仍要注入空目录=base）
    const skills = SkillPromptAggregator._collectSkills(registry, only)
    if (skills === null) {
      return base
    }

    if (opts?.catalogOnly === true) {
      return SkillPromptAggregator._injectCatalog(
        base,
        skills,
        opts?.catalogMaxChars ?? DEFAULT_SKILL_CATALOG_MAX_CHARS,
      )
    }

    const frags = skills
      .map((s) => SkillAdapter.promptFragment(s))
      .filter((f): f is string => f !== null)

    if (frags.length === 0) {
      return base
    }

    const merged = (base || '') + '\n\n' + frags.join('\n\n')
    return merged
  }

  /**
   * 按选择收集技能实例。
   *
   * @returns null 表示聚合失败（调用方回退 base）；数组可能为空。
   */
  private static _collectSkills(
    registry: ComponentRegistry,
    only?: string[],
  ): import('../core/interfaces/skill.js').BaseSkill[] | null {
    try {
      if (only !== undefined) {
        const out: import('../core/interfaces/skill.js').BaseSkill[] = []
        for (const name of only) {
          const skill = registry.getSkill(name)
          if (skill !== undefined) out.push(skill)
        }
        return out
      }

      const names = Object.keys(registry.listSkills())
      return names
        .map((n) => registry.getSkill(n))
        .filter((s): s is import('../core/interfaces/skill.js').BaseSkill => s !== undefined)
    } catch (e: any) {
      // 提示注入失败降级
      logger.warning('Skill prompt aggregation failed, fallback to base: %s', e)
      return null
    }
  }

  /**
   * 生成 L1 目录文本并拼到 base 之后。
   *
   * 目录不含正文与 examples（它们属 L2，由 load_skill 按需返回）。
   */
  private static _injectCatalog(
    base: string | null,
    skills: import('../core/interfaces/skill.js').BaseSkill[],
    maxChars: number,
  ): string | null {
    if (skills.length === 0) {
      return base
    }

    const entries: SkillCatalogEntry[] = []
    for (const skill of skills) {
      let summary = ''
      try {
        summary = summarizeSkillDescription(skill.description())
      } catch {
        summary = ''
      }
      entries.push({ name: skill.name(), summary })
    }

    const budget = Math.max(0, maxChars)
    const lines: string[] = []
    let used = 0
    let truncated = false
    for (const entry of entries) {
      const line = `- ${entry.name}${entry.summary ? `: ${entry.summary}` : ''}`
      // +1 为换行符开销
      if (used + line.length + 1 > budget) {
        truncated = true
        break
      }
      lines.push(line)
      used += line.length + 1
    }

    if (lines.length === 0) {
      // 预算过小：宁可不注入，也不输出半行内容
      return base
    }

    const header = '[Skills]'
    const footer =
      '调用 load_skill(name) 获取完整指令与示例；未加载前不要假设其细节。' +
      (truncated ? '\n[truncated]' : '')

    const block = `${header}\n${lines.join('\n')}\n${footer}`
    return (base || '') + '\n\n' + block
  }
}
