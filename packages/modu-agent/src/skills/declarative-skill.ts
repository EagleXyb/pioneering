// skills/declarative-skill.ts
//
// P1-b（L3-2）：纯提示型技能。
//
// 价值：让非研发同学也能投放技能——只需 `manifest.json` + `prompts/system.md`，
// 不需要写 TypeScript 类。与 `MathSkill` 这类「代码技能」共存，运行时无差异：
// 注册后同样贡献 `systemPromptFragment()`（无可执行工具）。
//
// 目录约定：
//   skills/<name>/manifest.json      { name, version, description, tags, dependencies, entry? }
//   skills/<name>/prompts/system.md  正文（缺失时回退 manifest.description）
import fs from 'fs'
import path from 'path'

import { BaseSkill } from '../core/interfaces/skill.js'

const logger = {
  warning: (msg: string, ...args: any[]) => console.warn(`[skills.declarative] ${msg}`, ...args),
}

export interface DeclarativeSkillInput {
  name: string
  version: string
  description: string
  tags?: string[]
  /** 正文文件绝对路径（可选） */
  promptFile?: string | null
  /** 或直接给正文 */
  prompt?: string | null
  sourcePath?: string
}

/** 读取 Markdown 正文（失败返回 null，不抛异常）。 */
export function readPromptFile(file: string): string | null {
  try {
    if (!fs.existsSync(file)) return null
    const text = fs.readFileSync(file, 'utf8')
    return text.trim() ? text : null
  } catch (e: any) {
    logger.warning('read prompt file failed (%s): %s', file, String(e?.message ?? e))
    return null
  }
}

/**
 * 纯提示型技能：只有元数据 + system prompt 片段，无工具。
 */
export class DeclarativeSkill extends BaseSkill {
  private readonly _name: string
  private readonly _version: string
  private readonly _description: string
  private readonly _tags: string[]
  private readonly _prompt: string | null
  readonly sourcePath?: string

  constructor(input: DeclarativeSkillInput) {
    super()
    this._name = input.name
    this._version = input.version
    this._description = input.description
    this._tags = input.tags ?? []
    this._prompt = input.prompt ?? null
    this.sourcePath = input.sourcePath
  }

  name(): string {
    return this._name
  }

  version(): string {
    return this._version
  }

  description(): string {
    return this._description
  }

  tags(): string[] {
    return this._tags
  }

  systemPromptFragment(): string | null {
    if (this._prompt && this._prompt.trim()) return this._prompt
    return this._description || null
  }

  /** 纯提示型技能不暴露工具（避免占用工具 schema 预算）。 */
  tools() {
    return []
  }
}

/** 解析目录内的提示正文路径（`prompts/system.md` 或根 `system.md`）。 */
export function resolvePromptFile(skillDir: string): string | null {
  const candidates = [
    path.join(skillDir, 'prompts', 'system.md'),
    path.join(skillDir, 'system.md'),
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}
