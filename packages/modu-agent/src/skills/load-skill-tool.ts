// skills/load-skill-tool.ts
//
// P1-c 渐进式披露（L2）：按需加载技能正文。
//
// 背景（对齐 Anthropic Agent Skills 的三层模型）：
//   L1 目录（name + 摘要）常驻 system prompt —— 由 SkillPromptAggregator.catalogOnly 产出；
//   L2 正文（systemPromptFragment + examples）体积大、只在相关时加载 —— 即本工具；
//   L3 资源（脚本 / 模板）本仓库暂不提供（无技能级沙箱）。
//
// 设计约束：
//   - 只允许加载「本轮被选中」的技能（allowed 白名单），未选中 / 未注册一律 fail-soft；
//   - 返回结构与其他工具一致（status / data），异常不外泄到图；
//   - 正文按字符预算截断，避免单次加载撑爆上下文；
//   - 工具实例按「图构建期」创建（不入全局注册表），避免不同选择互相覆盖白名单。
import fs from 'fs'
import path from 'path'

import { BaseTool } from '../core/interfaces/action.js'
import type { BaseSkill } from '../core/interfaces/skill.js'
import type { ComponentRegistry } from '../core/registry.js'
import { SkillAdapter } from './adapter.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[skills.load_skill] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[skills.load_skill] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[skills.load_skill] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[skills.load_skill] ${msg}`, ...args),
}

/** 默认正文预算（字符）。 */
export const DEFAULT_SKILL_LOAD_MAX_CHARS = 6000

export interface LoadSkillToolOptions {
  registry: Pick<ComponentRegistry, 'getSkill'>
  /** 本轮允许加载的技能名（来自请求侧选择） */
  allowed: string[]
  /** 单次加载的正文字符预算 */
  maxChars?: number
  /** 可选：用于解析 entry 之外的纯 Markdown 正文（P1-b 预留，当前未使用） */
  docsDir?: string | null
}

/** 加载失败的标准错误结构（与 SkillToolWrapper 口径一致）。 */
function skillError(code: string, message: string, skill: string): Record<string, any> {
  return {
    status: 'error',
    error_code: code,
    data: { message, skill },
  }
}

/**
 * `load_skill` 工具：返回技能完整指令（+ examples），供模型按需展开。
 *
 * 幂等：重复加载返回同一正文；是否重复注入由对话历史自然决定（工具结果已在消息中）。
 */
export class LoadSkillTool extends BaseTool {
  private readonly _registry: Pick<ComponentRegistry, 'getSkill'>
  private readonly _allowed: Set<string>
  private readonly _maxChars: number
  private readonly _docsDir: string | null

  constructor(opts: LoadSkillToolOptions) {
    super()
    this._registry = opts.registry
    this._allowed = new Set((opts.allowed ?? []).map(String))
    this._maxChars = Math.max(200, Number(opts.maxChars ?? DEFAULT_SKILL_LOAD_MAX_CHARS))
    this._docsDir = opts.docsDir ?? null
  }

  name(): string {
    return 'load_skill'
  }

  description(): string {
    return (
      '加载指定技能的完整指令与示例。' +
      '当 [Skills] 目录里的技能与当前任务相关时，先调用本工具获取其完整说明，再按说明行动；' +
      '未加载前不要假设技能细节。已加载过的技能无需重复调用（正文已在对话上下文中）。' +
      '参数 name 为技能名。'
    )
  }

  parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '要加载的技能名（见 [Skills] 目录）',
        },
      },
      required: ['name'],
      additionalProperties: false,
    }
  }

  async invoke(params: Record<string, any>): Promise<Record<string, any>> {
    const name = String(params?.['name'] ?? '').trim()
    if (!name) {
      return skillError('SKILL_NOT_AVAILABLE', '缺少技能名参数', '')
    }
    if (!this._allowed.has(name)) {
      // 未选中 = 不可见：与「工具未绑定」语义一致，避免模型试探出未启用能力
      return skillError(
        'SKILL_NOT_AVAILABLE',
        `技能 '${name}' 不在本轮可用范围内`,
        name,
      )
    }

    let skill: BaseSkill | undefined
    try {
      skill = this._registry.getSkill(name)
    } catch {
      skill = undefined
    }
    if (!skill) {
      return skillError('SKILL_NOT_AVAILABLE', `技能 '${name}' 未注册`, name)
    }
    try {
      if (typeof skill.isAvailable === 'function' && !skill.isAvailable()) {
        return skillError('SKILL_NOT_AVAILABLE', `技能 '${name}' 当前不可用`, name)
      }
    } catch {
      return skillError('SKILL_NOT_AVAILABLE', `技能 '${name}' 当前不可用`, name)
    }

    try {
      const instructions = this._resolveInstructions(skill)
      const examples = this._resolveExamples(skill)
      const truncated = instructions.length > this._maxChars
      const body = truncated
        ? `${instructions.slice(0, this._maxChars)}\n[truncated]`
        : instructions

      logger.info(
        'loaded skill=%s version=%s chars=%d truncated=%s',
        name, safeVersion(skill), body.length, truncated,
      )

      return {
        status: 'success',
        data: {
          skill: name,
          version: safeVersion(skill),
          instructions: body,
          examples,
          truncated,
        },
      }
    } catch (e: any) {
      // 与 SkillToolWrapper 同口径：绝不让技能异常外泄到图
      logger.error("load_skill failed for '%s': %s", name, String(e))
      return skillError('SKILL_LOAD_FAILED', String(e?.message ?? e), name)
    }
  }

  /** 优先 systemPromptFragment；缺失时回退 description；再回退 entry 指向的 Markdown。 */
  private _resolveInstructions(skill: BaseSkill): string {
    const frag = typeof skill.systemPromptFragment === 'function'
      ? skill.systemPromptFragment()
      : null
    if (frag && frag.trim()) return frag

    // P1-b 预留：声明式技能的正文文件（manifest.entry / prompts/system.md）
    const fromFile = this._readDocFile(skill)
    if (fromFile) return fromFile

    const desc = typeof skill.description === 'function' ? skill.description() : ''
    return String(desc ?? '')
  }

  /** 读取技能目录下的 Markdown 正文（仅当 docsDir 显式提供时）。 */
  private _readDocFile(skill: BaseSkill): string | null {
    if (!this._docsDir) return null
    try {
      const name = String(skill.name() ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
      if (!name) return null
      const file = path.join(path.resolve(this._docsDir), name, 'system.md')
      if (!fs.existsSync(file)) return null
      return fs.readFileSync(file, 'utf8')
    } catch {
      return null
    }
  }

  /** examples 统一为 [{input, output}]，并过滤空项。 */
  private _resolveExamples(skill: BaseSkill): Array<{ input: string; output: string }> {
    if (typeof skill.examples !== 'function') return []
    let raw: Array<Record<string, string>> = []
    try {
      raw = skill.examples() ?? []
    } catch {
      return []
    }
    return raw
      .map((ex) => ({
        input: String(ex?.['input'] ?? ''),
        output: String(ex?.['output'] ?? ''),
      }))
      .filter((ex) => ex.input || ex.output)
  }
}

function safeVersion(skill: BaseSkill): string {
  try {
    return typeof skill.version === 'function' ? String(skill.version()) : ''
  } catch {
    return ''
  }
}
