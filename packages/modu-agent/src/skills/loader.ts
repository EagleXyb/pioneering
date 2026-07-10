// 对应 Python: skills/loader.py
// Skill 动态加载器（P2）。
//
// 采用适配器/插件扫描模式，支持两种来源：
//   1. 目录扫描：遍历 skills.auto_discover_dirs 下每个 <skill>/skill.{js,ts}，
//      提取模块级 skill（BaseSkill 实例）或 skills（列表）导出。
//   2. 配置驱动：读 skills.enabled / skills.active，仅激活白名单 Skill。
//
// 每个 Skill 的导入与实例化均被 try/except 隔离（P5 加载隔离），
// 单个 Skill 失败仅告警并跳过，绝不阻断 Agent 启动。
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

import type { RuntimeConfig } from '../config/runtime-config.js'
import type { BaseSkill } from '../core/interfaces/skill.js'
import type { ComponentRegistry } from '../core/registry.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[skills.loader] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[skills.loader] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[skills.loader] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[skills.loader] ${msg}`, ...args),
}

export class SkillLoader {
  private _registry: ComponentRegistry
  private _config: RuntimeConfig

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
   * 约定：<base>/<skill_name>/skill.{js,ts} 中导出 skill 或 skills。
   * 每个模块导入失败均被隔离记录，不影响其他 Skill。
   *
   * @param paths 待扫描的根目录列表
   * @returns 发现的 BaseSkill 实例列表（去重按 name）
   */
  async discover(paths: string[]): Promise<BaseSkill[]> {
    const found: Map<string, BaseSkill> = new Map()

    for (const base of paths) {
      const basePath = path.resolve(base)
      if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
        logger.debug('Skill discover path not a dir, skip: %s', base)
        continue
      }

      const subs = fs.readdirSync(basePath).sort()
      for (const subName of subs) {
        const subPath = path.join(basePath, subName)
        if (!fs.statSync(subPath).isDirectory()) {
          continue
        }

        // 查找 skill.js 或 skill.ts
        let skillFile: string | null = null
        const jsFile = path.join(subPath, 'skill.js')
        const tsFile = path.join(subPath, 'skill.ts')
        if (fs.existsSync(jsFile)) {
          skillFile = jsFile
        } else if (fs.existsSync(tsFile)) {
          skillFile = tsFile
        }

        if (!skillFile) {
          continue
        }

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
    }

    return [...found.values()]
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
}
