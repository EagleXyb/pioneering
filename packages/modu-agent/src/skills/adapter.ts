// 对应 Python: skills/adapter.py
// Skill 适配器（P2）。
//
// 提供两个职责：
//   1. SkillAdapter：把 BaseSkill 降解为图可消费的两类产物
//      —— 工具名列表 + system prompt 片段（含 examples）。
//   2. SkillToolWrapper：执行隔离包装，捕获 Skill 工具内部的任意异常，
//      返回与现有工具一致的错误结构，
//      避免 Skill 缺陷外泄到 LangGraph 图导致整个请求失败。
import { BaseTool } from '../core/interfaces/action.js'
import type { BaseSkill } from '../core/interfaces/skill.js'
import { setSkillToolWrapperFactory } from '../core/registry.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[skills.adapter] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[skills.adapter] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[skills.adapter] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[skills.adapter] ${msg}`, ...args),
}

/**
 * 把 BaseSkill 降解为工具集 + 提示片段。
 */
export class SkillAdapter {
  /** 返回 Skill 内含工具名列表。 */
  static toolNames(skill: BaseSkill): string[] {
    return skill.tools().map((t) => t.name())
  }

  /**
   * 构建注入 LLM 的提示片段（含可选 examples）。
   *
   * @returns 提示字符串，或 null（当 Skill 无提示/描述时返回 null 以避免注入空片段）。
   */
  static promptFragment(skill: BaseSkill): string | null {
    const frag = skill.systemPromptFragment()
    if (!frag && !skill.description()) {
      return null
    }

    const header = `[Skill: ${skill.name()} v${skill.version()}]`
    const body = frag || skill.description()

    const examples = skill.examples()
    let exampleText = ''
    if (examples && examples.length > 0) {
      const lines: string[] = []
      for (const ex of examples) {
        const inp = ex.input || ''
        const out = ex.output || ''
        lines.push(`  输入: ${inp}\n  输出: ${out}`)
      }
      exampleText = '\nExamples:\n' + lines.join('\n')
    }

    return `${header}\n${body}${exampleText}`
  }
}

/**
 * 执行隔离包装（P5 降级机制）。
 *
 * 委托被包装工具的全部接口，仅在 invoke 外层捕获异常，
 * 保证 Skill 工具任何运行时错误都被标准化为错误字典，不影响图的 ReAct 循环。
 *
 * 包装后 name() 保持不变，因此注册中心/图/function calling 视角无差异。
 */
export class SkillToolWrapper extends BaseTool {
  private _inner: BaseTool
  private _skillName: string

  constructor(inner: BaseTool, skillName: string) {
    super()
    this._inner = inner
    this._skillName = skillName
  }

  name(): string {
    return this._inner.name()
  }

  description(): string {
    return this._inner.description()
  }

  parametersSchema(): Record<string, any> {
    return this._inner.parametersSchema()
  }

  requiresApproval(): boolean {
    return this._inner.requiresApproval()
  }

  onApprovalRejected(params: Record<string, any>): Record<string, any> {
    return this._inner.onApprovalRejected(params)
  }

  async invoke(
    params: Record<string, any>,
    context: Record<string, any>,
  ): Promise<Record<string, any>> {
    try {
      return await this._inner.invoke(params, context)
    } catch (e: any) {
      // 执行隔离：绝不让 Skill 异常外泄
      logger.error(
        "Skill tool '%s' (skill=%s) failed: %s",
        this._inner.name(), this._skillName, e,
      )
      return {
        status: 'error',
        error_code: 'SKILL_EXECUTION_FAILED',
        data: { message: String(e), skill: this._skillName },
      }
    }
  }
}

// ============================================================
// P1: 工厂注入——对应 Python `from skills.adapter import SkillToolWrapper`
// 的延迟导入。模块加载时将工厂注入 registry，避免 ESM 循环依赖。
// ============================================================
setSkillToolWrapperFactory((tool: BaseTool, skillName: string) => new SkillToolWrapper(tool, skillName))
