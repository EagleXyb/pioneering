// skills/selection.ts
//
// 技能选择的纯函数解析（P0 · 打通「选择 → 执行」）。
//
// 职责：
//   把「请求侧传入的技能名列表」解析为图装配期可直接消费的三类产物：
//     1. promptSkills —— 参与 system prompt 聚合的技能名（undefined = 全部）
//     2. toolNames    —— 该选择允许绑定的技能工具名（undefined = 不裁剪）
//     3. catalog      —— 目录条目（name + 摘要），供 P1-c 渐进式披露消费
//
// 设计约束（严守「默认等价 / 失败降级」）：
//   - selected 为 undefined/null 时全部返回 undefined：调用方保持改造前行为（零侵入）；
//   - selected 为空数组时表示「明确不使用技能」：promptSkills=[]、toolNames=[]；
//   - 未注册 / 不可用的技能只记录到 ignored，绝不抛异常（与 SkillLoader 隔离语义一致）。
import type { BaseSkill } from '../core/interfaces/skill.js'
import type { ComponentRegistry } from '../core/registry.js'

/** 目录条目：仅含路由所需的最小信息（L1 层）。 */
export interface SkillCatalogEntry {
  name: string
  /** 一句话摘要（description 首句，截断至 summarize 上限） */
  summary: string
}

/** resolveSkillSelection 的解析结果。 */
export interface SkillSelectionResult {
  /** 参与提示聚合的技能名；undefined = 不限定（全部已注册技能） */
  promptSkills: string[] | undefined
  /** 允许绑定的技能工具名；undefined = 不裁剪 */
  toolNames: string[] | undefined
  /** 被忽略的选择项（未注册 / 不可用） */
  ignored: string[]
  /** 目录条目（按选择顺序，去重） */
  catalog: SkillCatalogEntry[]
}

/** 空选择结果（未启用技能 / 未传 skills 时复用，避免每次构造新对象）。 */
export const EMPTY_SKILL_SELECTION: SkillSelectionResult = {
  promptSkills: undefined,
  toolNames: undefined,
  ignored: [],
  catalog: [],
}

/**
 * 取 description 的首句作为目录摘要。
 *
 * 中英文标点均作为句子边界；超长截断并追加省略号，避免目录注入挤占上下文。
 */
export function summarizeSkillDescription(description: unknown, maxChars = 40): string {
  const text = String(description ?? '').trim()
  if (!text) return ''
  const first = text.split(/[。．\.!！？?；;\n]/)[0]?.trim() || text
  const limit = Math.max(1, maxChars)
  return first.length > limit ? `${first.slice(0, limit)}…` : first
}

/** 解析选项（L4-4.1：权限 scope）。 */
export interface SkillSelectionOptions {
  /**
   * 调用方持有的权限 scope。
   *
   * `undefined` = 不校验（向后兼容：宿主尚未接入身份体系时行为不变）；
   * 提供数组时，技能声明的 `requiredScopes()` 必须**全部**命中，否则该技能被忽略。
   */
  scopes?: string[]
}

/**
 * 解析技能选择。
 *
 * @param registry 组件注册表（可为最小桩，仅需 getSkill）
 * @param selected 请求侧技能名列表；undefined/null = 不限定
 * @param opts     权限 scope 等解析选项
 * @returns 见 {@link SkillSelectionResult}
 */
export function resolveSkillSelection(
  registry: Pick<ComponentRegistry, 'getSkill'> | null | undefined,
  selected?: string[] | null,
  opts?: SkillSelectionOptions,
): SkillSelectionResult {
  // undefined / null = 调用方未声明选择 → 保持改造前行为（不裁剪、不过滤）
  if (selected === undefined || selected === null) {
    return EMPTY_SKILL_SELECTION
  }

  const wanted = [...new Set(
    (Array.isArray(selected) ? selected : [])
      .map((s) => String(s ?? '').trim())
      .filter((s) => s.length > 0),
  )]

  const promptSkills: string[] = []
  const toolNames = new Set<string>()
  const ignored: string[] = []
  const catalog: SkillCatalogEntry[] = []
  // L4-4.1：宿主提供 scopes 时才校验；未提供 = 不改变既有行为
  const scopeSet = Array.isArray(opts?.scopes) ? new Set(opts!.scopes!.map(String)) : null

  for (const name of wanted) {
    let skill: BaseSkill | undefined
    try {
      skill = registry?.getSkill?.(name)
    } catch {
      skill = undefined
    }

    if (!skill) {
      ignored.push(name)
      continue
    }
    // isAvailable 抛错时按不可用处理（保持 fail-soft）
    try {
      if (typeof skill.isAvailable === 'function' && !skill.isAvailable()) {
        ignored.push(name)
        continue
      }
    } catch {
      ignored.push(name)
      continue
    }

    // 权限 scope（fail-closed）：声明了但调用方不具备 → 不暴露该技能
    if (scopeSet) {
      let required: string[] = []
      try {
        required = typeof skill.requiredScopes === 'function'
          ? (skill.requiredScopes() ?? []).map(String)
          : []
      } catch {
        required = []
      }
      if (required.some((s) => !scopeSet.has(s))) {
        ignored.push(name)
        continue
      }
    }

    promptSkills.push(name)
    catalog.push({
      name,
      summary: summarizeSkillDescription(
        typeof skill.description === 'function' ? skill.description() : '',
      ),
    })

    try {
      for (const tool of skill.tools?.() ?? []) {
        const toolName = typeof tool?.name === 'function' ? tool.name() : ''
        if (toolName) toolNames.add(toolName)
      }
    } catch {
      // 工具枚举失败不影响提示聚合（该技能仍参与提示，只是没有可绑定的工具）
    }
  }

  return {
    promptSkills,
    toolNames: [...toolNames],
    ignored,
    catalog,
  }
}

/**
 * 是否启用「渐进式披露」的 load_skill 工具。
 *
 * 三个条件缺一不可：技能总开关、渐进式披露开关、本轮至少选中一个技能。
 * 纯函数，便于门控矩阵单测（避免默认路径行为漂移）。
 */
export function shouldEnableProgressiveDisclosure(
  skillsEnabled: boolean,
  progressiveEnabled: boolean,
  promptSkills?: string[],
): boolean {
  return Boolean(
    skillsEnabled &&
    progressiveEnabled &&
    Array.isArray(promptSkills) &&
    promptSkills.length > 0,
  )
}

/**
 * 从工具集中剔除「技能工具中未被选中」的条目。
 *
 * - 非技能工具（内置 / MCP / 宿主注册）一律保留；
 * - 技能工具只有在 allowed 中才保留。
 *
 * 纯函数，便于单测覆盖 factory 的裁剪语义（不依赖真实建图）。
 */
export function pruneSkillTools<T extends { name?: string }>(
  tools: T[],
  allSkillToolNames: Set<string>,
  allowed: Set<string>,
): T[] {
  return tools.filter((tool) => {
    const name = typeof (tool as { name?: unknown })?.name === 'string'
      ? String((tool as { name?: string }).name)
      : ''
    return !allSkillToolNames.has(name) || allowed.has(name)
  })
}

/**
 * 收集所有已注册技能贡献的工具名（用于「未被选中 → 从绑定集剔除」）。
 *
 * 注意：这里返回的是 skill.tools() 声明的名字，可能包含因工具名冲突而**未真正注册**
 * 的条目。调用方只应在「该名字确实来自技能」的场景做剔除；当前装配路径中
 * SkillLoader 先于默认工具注册执行，冲突方多为默认工具，故保持一致。
 */
export function collectSkillToolNames(
  registry: Pick<ComponentRegistry, 'listSkills' | 'getSkill'> | null | undefined,
): Set<string> {
  const out = new Set<string>()
  let names: string[] = []
  try {
    names = Object.keys(registry?.listSkills?.() ?? {})
  } catch {
    return out
  }
  for (const name of names) {
    let skill: BaseSkill | undefined
    try {
      skill = registry?.getSkill?.(name)
    } catch {
      skill = undefined
    }
    if (!skill || typeof skill.tools !== 'function') continue
    try {
      for (const tool of skill.tools() ?? []) {
        const toolName = typeof tool?.name === 'function' ? tool.name() : ''
        if (toolName) out.add(toolName)
      }
    } catch {
      // 单个技能枚举失败不影响其余技能
    }
  }
  return out
}
