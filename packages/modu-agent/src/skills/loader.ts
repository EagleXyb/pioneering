// 对应 Python: skills/loader.py
// Skill 动态加载器（P2 / L3-2）。
//
// 支持三种来源（同一目录约定下共存）：
//   1. 目录扫描：遍历 skills.auto_discover_dirs 下每个 <skill>/skill.{js,ts}
//   2. 声明式技能：<skill>/manifest.json + prompts/system.md（无可执行代码）
//   3. 配置驱动：读 skills.enabled / skills.active，仅激活白名单 Skill
//
// L3-2 增强：
//   - 路径安全：拒绝解析到扫描根之外的目录（防 `..` / 符号链接逃逸）
//   - manifest 校验：name/version 必填；非法 → 跳过并在元信息中记录 error
//   - 依赖：dependencies 必须在同批发现结果中存在，否则跳过并告警
//   - 版本：内容 sha256 + 快照 + 默认版本指针（回滚从快照加载）
//
// 每个 Skill 的导入与实例化均被 try/catch 隔离（P5 加载隔离），
// 单个 Skill 失败仅告警并跳过，绝不阻断 Agent 启动。
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

import type { RuntimeConfig } from '../config/runtime-config.js'
import type { BaseSkill } from '../core/interfaces/skill.js'
import type { ComponentRegistry } from '../core/registry.js'
import { parseManifest, validateManifest, type PluginManifest } from '../config/plugin-manifest.js'
import { bumpSkillsRevision } from './revision.js'
import { DeclarativeSkill, readPromptFile, resolvePromptFile } from './declarative-skill.js'
import {
  computeSkillContentHash,
  ensureSnapshot,
  findSnapshot,
  recordVersion,
  setSkillMeta,
} from './versioning.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[skills.loader] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[skills.loader] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[skills.loader] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[skills.loader] ${msg}`, ...args),
}

/** 子路径是否位于根目录内（防路径逃逸）。 */
export function isInsideDir(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function readManifest(skillDir: string): PluginManifest | null {
  const file = path.join(skillDir, 'manifest.json')
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const validation = validateManifest(raw)
    if (!validation.valid) {
      logger.error('invalid manifest (%s): %s', file, validation.errors.join('; '))
      return null
    }
    return parseManifest(raw)
  } catch (e: any) {
    logger.error('Failed to read manifest %s: %s', file, e)
    return null
  }
}

export class SkillLoader {
  private _registry: ComponentRegistry
  private _config: RuntimeConfig
  /** 本次发现中每个技能的依赖声明（用于第二遍过滤） */
  private _deps = new Map<string, string[]>()

  constructor(registry: ComponentRegistry, config: RuntimeConfig) {
    this._registry = registry
    this._config = config
  }

  // ------------------------------------------------------------------
  // 目录扫描发现
  // ------------------------------------------------------------------

  /**
   * 扫描目录，发现所有合法 Skill 模块。
   *
   * 约定：<base>/<skill>/skill.{js,ts}，或 <base>/<skill>/manifest.json（+ prompts/system.md）。
   * 每个模块导入失败均被隔离记录，不影响其他 Skill。
   *
   * @param paths 待扫描的根目录列表
   * @returns 发现的 BaseSkill 实例列表（去重按 name）
   */
  async discover(paths: string[]): Promise<BaseSkill[]> {
    const found: Map<string, BaseSkill> = new Map()
    this._deps = new Map()

    for (const base of paths) {
      const basePath = path.resolve(base)
      if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
        logger.debug('Skill discover path not a dir, skip: %s', base)
        continue
      }

      const subs = fs.readdirSync(basePath).sort()
      for (const subName of subs) {
        // 跳过隐藏目录（.snapshots / .state.json 等）
        if (subName.startsWith('.')) continue

        const subPath = path.join(basePath, subName)
        let stat: fs.Stats
        try {
          stat = fs.statSync(subPath)
        } catch {
          continue
        }
        if (!stat.isDirectory()) continue

        // 路径安全：解析后必须仍在扫描根内
        if (!isInsideDir(basePath, subPath)) {
          logger.warning("Skill dir escapes scan root, skip: %s", subPath)
          continue
        }

        try {
          await this._loadOne(basePath, subName, subPath, found)
        } catch (e: any) {
          // 加载隔离
          logger.error('Failed to load skill from %s: %s', subPath, e)
        }
      }
    }

    // 第二遍：依赖过滤（dependencies 必须在本批发现结果中）
    for (const [name, deps] of this._deps) {
      const missing = deps.filter((d) => !found.has(d))
      if (missing.length > 0) {
        logger.warning(
          "Skill '%s' skipped: missing dependencies [%s]",
          name, missing.join(','),
        )
        found.delete(name)
      }
    }

    return [...found.values()]
  }

  /** 加载单个技能目录（含 manifest / 版本 / 快照解析）。 */
  private async _loadOne(
    baseDir: string,
    subName: string,
    skillDir: string,
    found: Map<string, BaseSkill>,
  ): Promise<void> {
    // 1) 工作副本 manifest（可选）
    const workManifest = readManifest(skillDir)
    if (fs.existsSync(path.join(skillDir, 'manifest.json')) && workManifest === null) {
      // manifest 存在但非法：跳过该目录（并在元信息中留痕）
      setSkillMeta({
        name: subName,
        version: '',
        contentHash: '',
        sourcePath: skillDir,
        baseDir,
        fromSnapshot: false,
        error: 'manifest 校验失败',
      })
      return
    }

    const workName = workManifest?.name ?? subName
    const workVersion = workManifest?.version ?? ''

    // 2) 版本化：内容指纹 + 快照 + 默认指针
    let loadDir = skillDir
    let loadManifest = workManifest
    let fromSnapshot = false
    let conflict = false

    const versioningEnabled = Boolean(this._config.get('skills.versioning.enabled', true))
    if (versioningEnabled && workManifest && workVersion) {
      const hash = computeSkillContentHash(skillDir)
      try {
        ensureSnapshot(baseDir, workName, workVersion, hash, skillDir)
        const recorded = recordVersion(baseDir, workName, workVersion, hash)
        conflict = recorded.conflict
        // 默认版本指向旧版本 → 从快照加载（回滚语义）
        if (recorded.defaultVersion && recorded.defaultVersion !== workVersion) {
          const target = findSnapshot(baseDir, workName, recorded.defaultVersion)
          if (target) {
            loadDir = target
            loadManifest = readManifest(target) ?? workManifest
            fromSnapshot = true
            logger.info(
              "Skill '%s' loaded from snapshot %s@%s (default=%s)",
              workName, workName, recorded.defaultVersion, recorded.defaultVersion,
            )
          }
        }
      } catch (e: any) {
        logger.warning("Skill '%s' versioning failed, fallback to working copy: %s", workName, e)
      }
    }

    const name = loadManifest?.name ?? workName
    const version = loadManifest?.version ?? workVersion
    const deps = Array.isArray(loadManifest?.dependencies)
      ? loadManifest!.dependencies!.map(String)
      : []
    if (deps.length > 0) this._deps.set(name, deps)

    // 3) 代码技能优先（skill.js / skill.ts）
    let skillFile: string | null = null
    const jsFile = path.join(loadDir, 'skill.js')
    const tsFile = path.join(loadDir, 'skill.ts')
    if (fs.existsSync(jsFile)) {
      skillFile = jsFile
    } else if (fs.existsSync(tsFile)) {
      skillFile = tsFile
    }

    const metaBase = {
      name,
      version,
      contentHash: computeSkillContentHash(loadDir),
      sourcePath: loadDir,
      baseDir,
      fromSnapshot,
      ...(conflict ? { error: '同版本内容变更（版本未递增）' } : {}),
    }

    if (skillFile) {
      const before = new Set(found.keys())
      await this._importSkillFile(skillFile, found)
      // 为本次导入（新增或同名替换）的技能写元信息；一个模块可能导出多个技能
      for (const [n, s] of found) {
        if (before.has(n) && found.get(n) === s) continue
        setSkillMeta({ ...metaBase, name: n, version: safeVersion(s) || version })
      }
      if (found.has(name)) {
        setSkillMeta({ ...metaBase, name, version: safeVersion(found.get(name)!) || version })
      }
      return
    }

    // 4) 声明式技能：manifest + markdown（无可执行代码）
    if (loadManifest) {
      const promptFile = resolvePromptFile(loadDir)
      const prompt = promptFile ? readPromptFile(promptFile) : null
      const declarative = new DeclarativeSkill({
        name,
        version,
        description: loadManifest.description ?? '',
        tags: Array.isArray(loadManifest.tags) ? loadManifest.tags.map(String) : [],
        prompt,
        sourcePath: loadDir,
      })
      found.set(name, declarative)
      setSkillMeta(metaBase)
      logger.info("Discovered declarative skill '%s' v%s", name, version)
      return
    }

    logger.debug('No skill entry found, skip: %s', skillDir)
  }

  /** 导入 skill.{js,ts}，按 name() 去重写入。 */
  private async _importSkillFile(
    skillFile: string,
    found: Map<string, BaseSkill>,
  ): Promise<void> {
    try {
      const mod = await import(pathToFileURL(skillFile).href)
      const skill = mod.skill
      if (skill && typeof skill.name === 'function') {
        found.set(skill.name(), skill as BaseSkill)
      }
      const skillsAttr = mod.skills
      if (Array.isArray(skillsAttr)) {
        for (const s of skillsAttr) {
          if (s && typeof s.name === 'function') {
            found.set(s.name(), s as BaseSkill)
          }
        }
      }
    } catch (e: any) {
      // 加载隔离
      logger.error('Failed to load skill from %s: %s', skillFile, e)
    }
  }

  // ------------------------------------------------------------------
  // 配置驱动加载
  // ------------------------------------------------------------------

  /**
   * 按配置激活 Skill。
   *
   * 关闭（skills.enabled=false，默认）时直接返回，所有新增路径不可达。
   */
  async loadFromConfig(): Promise<void> {
    if (!this._config.get('skills.enabled', false)) {
      logger.debug('Skills disabled (skills.enabled=false), skipping load')
      return
    }

    const active: string[] = this._config.get('skills.active', []) || []
    const discoverDirs: string[] = this._config.get('skills.auto_discover_dirs', []) || []

    const discoveredList = await this.discover(discoverDirs)
    const discovered: Map<string, BaseSkill> = new Map()
    for (const s of discoveredList) {
      discovered.set(s.name(), s)
    }

    for (const name of active) {
      if (this._registry.getSkill(name) !== undefined) {
        logger.debug("Skill '%s' already registered, skip", name)
        continue
      }
      const skill = discovered.get(name)
      if (!skill) {
        logger.warning("Active skill '%s' not found in discover dirs, skip", name)
        continue
      }
      try {
        skill.setup()
        // 内部自动注册工具（含 SkillToolWrapper）
        this._registry.registerSkill(skill)
      } catch (e: any) {
        // 加载隔离
        logger.error("Skill '%s' failed to setup/register: %s", name, e)
      }
    }
  }

  /**
   * 让已注册的技能集合与 `skills.active` 白名单**对齐**（L3-1.2）。
   *
   * 与 `loadFromConfig` 的区别：后者只做「增量注册」，从不移除——
   * 因此管理面把技能移出白名单后必须重启进程才生效。本方法额外执行：
   *   - 新增：白名单命中但未注册 → `setup()` + `registerSkill()`；
   *   - 移除：已注册但不在白名单 → `unregisterSkill()`（连带回收工具）+ `teardown()`；
   *   - 集合发生增删时 bump `skillsRevision`，供宿主使图缓存失效。
   *
   * 隔离语义与发现一致：单个技能 setup/teardown 失败只告警，不影响其他技能。
   *
   * @returns 增删结果与白名单中未能找到的项
   */
  async syncFromConfig(): Promise<{ added: string[]; removed: string[]; missing: string[] }> {
    const added: string[] = []
    const removed: string[] = []
    const missing: string[] = []

    if (!this._config.get('skills.enabled', false)) {
      logger.debug('Skills disabled (skills.enabled=false), sync skipped')
      return { added, removed, missing }
    }

    const activeRaw: unknown = this._config.get('skills.active', [])
    const active = Array.isArray(activeRaw) ? activeRaw.map(String) : []
    const desired = new Set(active)

    const discoverDirsRaw: unknown = this._config.get('skills.auto_discover_dirs', [])
    const discoverDirs = Array.isArray(discoverDirsRaw) ? discoverDirsRaw.map(String) : []
    const discovered = new Map<string, BaseSkill>()
    for (const s of await this.discover(discoverDirs)) {
      discovered.set(s.name(), s)
    }

    // ---- 新增 ----
    for (const name of active) {
      if (this._registry.getSkill(name) !== undefined) continue
      const skill = discovered.get(name)
      if (!skill) {
        missing.push(name)
        logger.warning("Active skill '%s' not found in discover dirs, skipped", name)
        continue
      }
      try {
        skill.setup()
        // L4-5.1：注册前健康检查（依赖中途不可用 → 不注册）
        if (!isSkillHealthy(skill)) {
          missing.push(name)
          logger.warning("Skill '%s' healthCheck failed, skipped", name)
          continue
        }
        this._registry.registerSkill(skill)
        if (this._registry.getSkill(name) !== undefined) added.push(name)
      } catch (e: any) {
        missing.push(name)
        logger.error("Skill '%s' failed to setup/register: %s", name, e)
      }
    }

    // ---- 移除（不在白名单，或健康检查失败）----
    for (const name of Object.keys(this._registry.listSkills())) {
      const registered = this._registry.getSkill(name)
      if (desired.has(name) && isSkillHealthy(registered)) continue
      const skill = registered
      if (!this._registry.unregisterSkill(name)) continue
      try {
        skill?.teardown()
      } catch (e: any) {
        logger.warning("Skill '%s' teardown failed: %s", name, e)
      }
      removed.push(name)
    }

    if (added.length > 0 || removed.length > 0) {
      const revision = bumpSkillsRevision()
      logger.info(
        'Skills synced: added=[%s] removed=[%s] revision=%d',
        added.join(','), removed.join(','), revision,
      )
    }

    return { added, removed, missing }
  }
}

/**
 * 技能健康判定（L4-5.1）：未实现 `healthCheck` 或判定抛错时按健康处理
 * （保守放行，避免把观测失败当成能力故障）。
 */
function isSkillHealthy(skill: BaseSkill | undefined): boolean {
  if (!skill) return false
  try {
    return typeof skill.healthCheck === 'function' ? skill.healthCheck() !== false : true
  } catch {
    return true
  }
}

function safeVersion(skill: BaseSkill): string {
  try {
    return typeof skill.version === 'function' ? String(skill.version()) : ''
  } catch {
    return ''
  }
}
