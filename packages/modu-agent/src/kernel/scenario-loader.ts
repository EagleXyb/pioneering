// scenario-loader.ts
//
// P3-B：场景包加载器 —— manifest 驱动的统一装配入口。
//
// 解决评估报告症结②「装配靠手动」③「场景包无处声明」：
//   读取 `packs/<name>/pack.yaml`，按 capabilities 把领域/Prompt/护栏/SOP/
//   配置/代码型拓扑扩展**自动分发**到各注册表；卸载时经 host 作用域回滚。
//
// 目录约定：
//   packs/<name>/
//     pack.yaml                 manifest（必需）
//     domains/<domain>.md       领域知识（frontmatter，能力 domain）
//     prompts/*.json            PromptTemplate 序列化（能力 prompt）
//     guardrails/rules.yaml     { rules: GuardrailRule[] }（能力 guardrail）
//     sop/roles.yaml            { roles: [...], plan_task_types: [...] }（能力 sop）
//     eval/                     评估口径目录（能力 eval，由 evals 包 --pack 消费）
//     entry.js                  代码型扩展 activate(host)（manifest.entry）
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { getRegistry } from '../core/registry.js'
import type { ComponentRegistry } from '../core/registry.js'
import { getConfig } from '../config/runtime-config.js'
import type { RuntimeConfig } from '../config/runtime-config.js'
import { parseYamlSubset } from '../config/yaml-loader.js'
import {
  docToDomainAdapter,
  parseMarkdownDoc,
} from '../config/markdown-loader.js'
import type { PromptTemplate } from '../core/interfaces/prompt.js'
import {
  ScenarioHost,
  type ScenarioEntryModule,
} from './scenario-host.js'

/** 场景包 manifest（pack.yaml）。 */
export interface ScenarioPackManifest {
  /** 场景包名（作用域标识，必需） */
  name: string
  /** 版本（必需） */
  version: string
  description?: string
  /** 声明本包启用的能力：domain/prompt/guardrail/sop/eval */
  capabilities?: string[]
  /** 代码型扩展入口（相对包目录的 .js 文件） */
  entry?: string
  /** 依赖的其他场景包名（先激活） */
  extends?: string[]
  /** 配置画像 */
  config_profile?: {
    /** 点分键覆盖 RuntimeConfig */
    agent_overrides?: Record<string, any>
    /** graph.spec.extra 画像开关 */
    graph_spec_extra?: Record<string, boolean>
  }
  [key: string]: any
}

const _REQUIRED_CAPABILITIES = ['domain', 'prompt', 'guardrail', 'sop', 'eval'] as const

/**
 * P1-4：路径沙箱断言——candidate 必须位于 baseDir 之内（含 baseDir 自身）。
 *
 * pack.yaml 可来自不可信分发源，entry/target 中的 `../../` 穿越不得指向
 * 约定目录之外，否则等同于任意路径代码加载。
 */
function assertInside(baseDir: string, candidate: string, label: string): void {
  const base = path.resolve(baseDir)
  const target = path.resolve(candidate)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`${label} 越界：${target} 不在允许目录 ${base} 内`)
  }
}

/** 校验 manifest 基本结构；返回错误列表（空=合法）。 */
function validatePackManifest(raw: any): string[] {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return ['manifest 必须是对象']
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('name 必须是非空字符串')
  if (typeof raw.version !== 'string' || !raw.version.trim()) errors.push('version 必须是非空字符串')
  if (raw.capabilities !== undefined && !Array.isArray(raw.capabilities)) {
    errors.push('capabilities 必须是数组')
  } else if (Array.isArray(raw.capabilities)) {
    for (const c of raw.capabilities) {
      if (!_REQUIRED_CAPABILITIES.includes(c)) {
        errors.push(`capabilities 含未知能力: ${String(c)}（合法值: ${_REQUIRED_CAPABILITIES.join('/')}）`)
      }
    }
  }
  if (raw.entry !== undefined && (typeof raw.entry !== 'string' || !raw.entry.trim())) {
    errors.push('entry 必须是非空字符串')
  }
  if (raw.extends !== undefined && !Array.isArray(raw.extends)) {
    errors.push('extends 必须是字符串数组')
  }
  return errors
}

/**
 * 场景包加载器（进程内单例范式）。
 */
export class ScenarioLoader {
  /** 场景包根目录（packs/）。 */
  readonly packsDir: string
  /** 组件注册中心。 */
  readonly registry: ComponentRegistry
  /** 运行时配置。 */
  readonly config: RuntimeConfig

  private _active: Map<string, ScenarioHost> = new Map()
  /**
   * P1-3：正在激活链路上的包名集合（环检测）。
   * A extends B、B extends A 时环上包永不进入 _active，旧实现会递归至栈溢出。
   */
  private _activating: Set<string> = new Set()

  constructor(opts: {
    packsDir?: string
    registry?: ComponentRegistry
    config?: RuntimeConfig
  } = {}) {
    this.registry = opts.registry ?? getRegistry()
    this.config = opts.config ?? getConfig()
    // 默认 packs 目录：<package-root>/packs
    this.packsDir = opts.packsDir ?? path.resolve(this._packageRoot(), 'packs')
  }

  private _packageRoot(): string {
    const here = path.dirname(fileURLToPath(import.meta.url))
    return path.resolve(here, '..', '..')
  }

  /** 场景包是否已激活。 */
  isActive(name: string): boolean {
    return this._active.has(name)
  }

  /** 获取已激活场景包宿主。 */
  getActive(name: string): ScenarioHost | null {
    return this._active.get(name) ?? null
  }

  /** 列出已激活场景包名。 */
  listActive(): string[] {
    return [...this._active.keys()]
  }

  /**
   * 激活场景包。
   *
   * @param target 包名（在 packsDir 下解析）或场景包目录绝对路径
   * @returns 场景包宿主
   */
  async activate(target: string): Promise<ScenarioHost> {
    // P1-4：target 解析后必须位于 packsDir 内——按名解析的相对路径天然在内，
    // 但绝对路径 / 含 ../ 的目录不得指向 packsDir 之外（不可信 manifest 分发面）。
    const directExists = fs.existsSync(target) && fs.statSync(target).isDirectory()
    const packDir = directExists
      ? path.resolve(target)
      : path.resolve(this.packsDir, target)
    assertInside(this.packsDir, packDir, 'scenario pack target')
    if (!fs.existsSync(packDir) || !fs.statSync(packDir).isDirectory()) {
      throw new Error(`scenario pack not found: ${target} (resolved: ${packDir})`)
    }

    const manifest = this._readManifest(packDir)
    if (this._active.has(manifest.name)) {
      return this._active.get(manifest.name)!
    }

    // P1-3：环检测。递归激活依赖前先压栈，链路上再次遇到同名包即循环依赖。
    if (this._activating.has(manifest.name)) {
      throw new Error(
        `circular scenario pack dependency detected: '${manifest.name}' is already being activated`,
      )
    }
    this._activating.add(manifest.name)

    try {
      // 依赖先行激活（环依赖在此处递归触发上抛）
      for (const dep of manifest.extends ?? []) {
        if (!this.isActive(dep)) await this.activate(dep)
      }

      const host = new ScenarioHost({
        scope: manifest.name,
        packDir,
        registry: this.registry,
        config: this.config,
      })

      // P1-2：配置画像 + 能力装配 + entry 激活作为一个事务段；
      // 任一步失败都逆序回滚本轮已注册资产，避免"部分激活"残留与同名包双重注册。
      const capabilities = new Set(manifest.capabilities ?? [])
      try {
        // 1. 配置画像
        const profile = manifest.config_profile
        if (profile?.graph_spec_extra) host.mergeGraphExtra(profile.graph_spec_extra)
        if (profile?.agent_overrides) host.applyConfigOverrides(profile.agent_overrides)

        // 2. 按能力装配（逐项隔离，单文件失败不阻断整包其余能力）
        if (capabilities.has('domain')) this._loadDomains(host, packDir)
        if (capabilities.has('prompt')) this._loadPrompts(host, packDir)
        if (capabilities.has('guardrail')) this._loadGuardrails(host, packDir)
        if (capabilities.has('sop')) this._loadSop(host, packDir)
        if (capabilities.has('eval')) this._checkEval(packDir)

        // 3. 代码型入口
        if (manifest.entry) await this._runEntry(host, packDir, manifest.entry)
      } catch (e) {
        // 激活失败：回滚本包已注册资产（依赖包由各自 activate 负责，保持激活）
        try {
          host.deactivate()
        } catch (rollbackErr: any) {
          console.error(
            `[kernel.loader] rollback after activation failure failed for '${manifest.name}': ` +
              String(rollbackErr?.message ?? rollbackErr),
          )
        }
        throw e
      }

      this._active.set(manifest.name, host)
      console.info(
        `[kernel.loader] scenario pack activated: ${manifest.name} v${manifest.version} ` +
        `(capabilities=[${[...capabilities].join(',')}], packDir=${packDir})`,
      )
      return host
    } finally {
      this._activating.delete(manifest.name)
    }
  }

  /**
   * 卸载场景包（作用域回滚）。
   * 若仍有其他激活包 extends 它则拒绝卸载。
   */
  async deactivate(name: string): Promise<void> {
    const host = this._active.get(name)
    if (!host) return

    const dependents = this._findDependents(name)
    if (dependents.length > 0) {
      throw new Error(
        `cannot deactivate pack '${name}': still required by active pack(s): ${dependents.join(', ')}`,
      )
    }

    host.deactivate()
    this._active.delete(name)
    console.info(`[kernel.loader] scenario pack deactivated: ${name}`)
  }

  // -------------------------------------------------------------------------
  // 内部装配步骤
  // -------------------------------------------------------------------------

  private _readManifest(packDir: string): ScenarioPackManifest {
    let file: string | null = null
    for (const candidate of ['pack.yaml', 'pack.yml']) {
      const abs = path.join(packDir, candidate)
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        file = abs
        break
      }
    }
    if (!file) throw new Error(`pack manifest missing: ${packDir}/pack.yaml`)

    const raw = parseYamlSubset(fs.readFileSync(file, 'utf-8'))
    const errors = validatePackManifest(raw)
    if (errors.length > 0) {
      throw new Error(`invalid pack manifest (${file}): ${errors.join('; ')}`)
    }
    return raw as ScenarioPackManifest
  }

  /** domains/<domain>.md → host.registerDomain */
  private _loadDomains(host: ScenarioHost, packDir: string): void {
    const dir = path.join(packDir, 'domains')
    for (const entry of this._readDirEntries(dir, '.md')) {
      try {
        const abs = path.join(dir, entry)
        const name = entry.slice(0, -'.md'.length)
        const doc = parseMarkdownDoc(fs.readFileSync(abs, 'utf-8'), name, abs)
        if (doc) host.registerDomain(name, docToDomainAdapter(doc))
      } catch (e: any) {
        console.warn(`[kernel.loader] domain load failed (${entry}): ${String(e?.message ?? e)}`)
      }
    }
  }

  /** prompts/*.json → host.registerPrompt */
  private _loadPrompts(host: ScenarioHost, packDir: string): void {
    const dir = path.join(packDir, 'prompts')
    for (const entry of this._readDirEntries(dir, '.json')) {
      try {
        const tpl = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf-8')) as PromptTemplate
        if (!tpl.id || !Array.isArray(tpl.messages)) {
          throw new Error('prompt 必须含 id 与 messages 数组')
        }
        host.registerPrompt(tpl)
      } catch (e: any) {
        console.warn(`[kernel.loader] prompt load failed (${entry}): ${String(e?.message ?? e)}`)
      }
    }
  }

  /** guardrails/rules.yaml → host.registerGuardrail */
  private _loadGuardrails(host: ScenarioHost, packDir: string): void {
    const file = path.join(packDir, 'guardrails', 'rules.yaml')
    if (!fs.existsSync(file)) return
    try {
      const parsed = parseYamlSubset(fs.readFileSync(file, 'utf-8'))
      const rules = parsed['rules']
      if (!Array.isArray(rules)) throw new Error('rules.yaml 必须含 rules 数组')
      for (const rule of rules) host.registerGuardrail(rule)
    } catch (e: any) {
      console.warn(`[kernel.loader] guardrail load failed: ${String(e?.message ?? e)}`)
    }
  }

  /** sop/roles.yaml → host 角色/步骤类型字典 */
  private _loadSop(host: ScenarioHost, packDir: string): void {
    const file = path.join(packDir, 'sop', 'roles.yaml')
    if (!fs.existsSync(file)) return
    try {
      const parsed = parseYamlSubset(fs.readFileSync(file, 'utf-8'))
      if (Array.isArray(parsed['roles'])) host.registerSopRoles(parsed['roles'].map(String))
      if (Array.isArray(parsed['plan_task_types'])) {
        host.registerPlanTaskTypes(parsed['plan_task_types'].map(String))
      }
    } catch (e: any) {
      console.warn(`[kernel.loader] SOP load failed: ${String(e?.message ?? e)}`)
    }
  }

  /** eval 能力：仅校验目录存在（实际加载由 evals 包 --pack 完成）。 */
  private _checkEval(packDir: string): void {
    const dir = path.join(packDir, 'eval')
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      console.warn(`[kernel.loader] capability 'eval' declared but eval/ directory absent: ${packDir}`)
    }
  }

  /** 代码型入口动态导入并调用 activate。 */
  private async _runEntry(
    host: ScenarioHost,
    packDir: string,
    entrySpec: string,
  ): Promise<void> {
    const entryAbs = path.resolve(packDir, entrySpec)
    // P1-4：entry 必须解析在包目录之内，拒绝 ../../evil.js 越界加载
    assertInside(packDir, entryAbs, 'pack entry')
    if (!fs.existsSync(entryAbs)) throw new Error(`pack entry not found: ${entryAbs}`)

    const mod = (await import(pathToFileURL(entryAbs).href)) as ScenarioEntryModule
    const fn = typeof mod.activate === 'function'
      ? mod.activate
      : typeof mod.default === 'function'
        ? mod.default
        : null
    if (!fn) {
      throw new Error(`pack entry '${entrySpec}' must export activate(host) or default export a function`)
    }
    await fn(host)
  }

  /** 扫描目录下指定后缀条目（排序；目录缺失返回空）。 */
  private _readDirEntries(dir: string, suffix: string): string[] {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []
    return fs.readdirSync(dir)
      .filter((e) => e.endsWith(suffix))
      .sort()
  }

  /** 查找仍 extends 指定包的激活包名。 */
  private _findDependents(name: string): string[] {
    const out: string[] = []
    for (const [packName, host] of this._active) {
      if (packName === name) continue
      try {
        const manifest = this._readManifest(host.packDir)
        if ((manifest.extends ?? []).includes(name)) out.push(packName)
      } catch {
        // 忽略读取失败
      }
    }
    return out
  }
}

// ============================================================
// 全局单例
// ============================================================

let _loader: ScenarioLoader | null = null

/** 获取全局 ScenarioLoader 单例。 */
export function getScenarioLoader(opts?: {
  packsDir?: string
  registry?: ComponentRegistry
  config?: RuntimeConfig
}): ScenarioLoader {
  if (_loader === null) _loader = new ScenarioLoader(opts)
  return _loader
}

/** 重置全局 loader（测试隔离用；不卸载已激活包，测试应先 deactivate）。 */
export function resetScenarioLoader(): void {
  _loader = null
}
