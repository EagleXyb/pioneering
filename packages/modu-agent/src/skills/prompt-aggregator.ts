// 对应 Python: skills/prompt_aggregator.py
// Skill 提示聚合器（P2）。
//
// 把当前已注册的所有 Skill 提示片段合并为一段注入 LLM 的 system prompt 补充。
// 无激活 Skill 时返回原始 base 提示，行为等价于改造前。
import type { ComponentRegistry } from '../core/registry.js'
import { SkillAdapter } from './adapter.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[skills.prompt_aggregator] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[skills.prompt_aggregator] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[skills.prompt_aggregator] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[skills.prompt_aggregator] ${msg}`, ...args),
}

export class SkillPromptAggregator {
  /**
   * 合并 base 提示与所有已注册 Skill 的提示片段。
   *
   * @param base 原始 system prompt（可能为 null）
   * @param registry 组件注册中心
   * @returns 合并后的提示；若无任何 Skill 片段则返回 base（原样）。
   */
  static aggregate(base: string | null, registry: ComponentRegistry): string | null {
    let skills: import('../core/interfaces/skill.js').BaseSkill[] = []
    try {
      const names = Object.keys(registry.listSkills())
      skills = names
        .map((n) => registry.getSkill(n))
        .filter((s): s is import('../core/interfaces/skill.js').BaseSkill => s !== undefined)
    } catch (e: any) {
      // 提示注入失败降级
      logger.warning('Skill prompt aggregation failed, fallback to base: %s', e)
      return base
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
}
