// 技能启用状态持久化（L3，文件系统实现）
//
// 为什么不用 DB：schema.prisma 存在历史漂移（db push 不可用），新增表需手工补；
// 管理面第一阶段只维护「一个字符串数组」，用 JSON 文件足够，且便于回滚与人工排查。
//
// 语义：
//   - 文件存在 → 文件中的 active 覆盖 config.yaml（管理员在 UI 的改动优先）
//   - 文件不存在 → 使用 config.yaml 的 skills.active（默认基线）
//
// 写入时机：POST /skills/:name/activate|deactivate、POST /skills/reload
import fs from 'fs'
import path from 'path'

import { env } from '../config/env.js'
import { getConfig } from '@pioneering/modu-agent'

export interface SkillState {
  active: string[]
  updatedAt: string
  updatedBy: string
}

/** 状态文件路径（测试可注入）。 */
export function skillStatePath(filePath?: string): string {
  return path.resolve(filePath ?? env.SKILLS_STATE_PATH)
}

/** 读取持久化状态；文件缺失 / 损坏时返回 null（调用方回退 config.yaml）。 */
export function readSkillState(filePath?: string): SkillState | null {
  const file = skillStatePath(filePath)
  try {
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const active = Array.isArray(parsed.active)
      ? parsed.active.filter((v: unknown): v is string => typeof v === 'string')
      : []
    return {
      active,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : '',
    }
  } catch {
    return null
  }
}

/** 写入持久化状态（原子性足够：先写临时文件再 rename）。 */
export function writeSkillState(
  active: string[],
  updatedBy: string,
  filePath?: string,
): SkillState {
  const file = skillStatePath(filePath)
  const state: SkillState = {
    active: [...new Set(active.map(String).filter((s) => s.trim()))].sort(),
    updatedAt: new Date().toISOString(),
    updatedBy,
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return state
}

/**
 * 启动时应用持久化状态（文件优先于 config.yaml）。
 *
 * @returns 是否命中文件；active 为最终生效值
 */
export function applyPersistedSkillState(
  config: { get: (k: string, d?: any) => any; set: (k: string, v: any) => void } = getConfig(),
  filePath?: string,
): { applied: boolean; active: string[] } {
  const state = readSkillState(filePath)
  if (!state) {
    const current = config.get('skills.active', [])
    return { applied: false, active: Array.isArray(current) ? current.map(String) : [] }
  }
  config.set('skills.active', state.active)
  return { applied: true, active: state.active }
}

/**
 * 更新白名单并落盘（管理面写路径）。
 *
 * 仅改内存配置 + 文件，不触发注册表变更——调用方随后应执行
 * `SkillLoader.syncFromConfig()` 与 `invalidateAgentGraphCache()`。
 */
export function setActiveSkills(
  active: string[],
  updatedBy: string,
  filePath?: string,
): SkillState {
  const state = writeSkillState(active, updatedBy, filePath)
  getConfig().set('skills.active', state.active)
  return state
}
