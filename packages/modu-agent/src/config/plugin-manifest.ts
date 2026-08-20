// plugin-manifest.ts
//
// P2（文档 4.3 建议8 / 4.4-P2）落地项：插件 / 技能 manifest 元数据。
//
// 提供 plugins/<name>/manifest.json（技能元数据：name/version/capabilities/dependencies）
// 的解析、校验与加载，供 skills/loader.ts 等消费方可选使用。
//
// 设计约束（严守"不修改原有业务逻辑、不引入新缺陷"）：
//   - 纯工具、无副作用：不改变 SkillLoader 现有扫描/激活逻辑；
//     loader 可选用本模块校验 manifest，但默认路径不依赖它。
//   - 校验失败返回带错误信息的 null，不抛异常（对调用方友好）。

import fs from 'fs'
import path from 'path'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[config.plugin_manifest] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[config.plugin_manifest] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[config.plugin_manifest] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[config.plugin_manifest] ${msg}`, ...args),
}

/** 插件 / 技能元数据 manifest。 */
export interface PluginManifest {
  /** 插件名（必须） */
  name: string
  /** 版本（必须，semver 风格字符串） */
  version: string
  /** 能力列表 */
  capabilities?: string[]
  /** 依赖列表 */
  dependencies?: string[]
  /** 入口模块（相对路径） */
  entry?: string
  /** 描述 */
  description?: string
  /** 附加字段原样保留 */
  [key: string]: any
}

/** manifest 校验结果。 */
export interface ManifestValidation {
  valid: boolean
  errors: string[]
}

/**
 * 校验 manifest 结构。
 *
 * 规则：
 *   - name 必填且非空字符串；
 *   - version 必填且非空字符串；
 *   - capabilities / dependencies 若存在必须为字符串数组；
 *   - entry 若存在必须为非空字符串。
 *
 * @param manifest 待校验的 manifest
 * @returns { valid, errors }
 */
export function validateManifest(manifest: unknown): ManifestValidation {
  const errors: string[] = []
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['manifest 必须是非空对象'] }
  }
  const m = manifest as Record<string, any>

  if (typeof m.name !== 'string' || m.name.trim() === '') {
    errors.push('name 必须是非空字符串')
  }
  if (typeof m.version !== 'string' || m.version.trim() === '') {
    errors.push('version 必须是非空字符串')
  }
  if (m.capabilities !== undefined && !Array.isArray(m.capabilities)) {
    errors.push('capabilities 必须是数组')
  } else if (Array.isArray(m.capabilities) && m.capabilities.some((c: unknown) => typeof c !== 'string')) {
    errors.push('capabilities 数组元素必须为字符串')
  }
  if (m.dependencies !== undefined && !Array.isArray(m.dependencies)) {
    errors.push('dependencies 必须是数组')
  } else if (Array.isArray(m.dependencies) && m.dependencies.some((d: unknown) => typeof d !== 'string')) {
    errors.push('dependencies 数组元素必须为字符串')
  }
  if (m.entry !== undefined && (typeof m.entry !== 'string' || m.entry.trim() === '')) {
    errors.push('entry 必须是非空字符串')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 解析并校验 manifest 对象。
 *
 * @param raw 解析后的 JSON 对象
 * @returns 校验通过返回 PluginManifest，否则返回 null
 */
export function parseManifest(raw: unknown): PluginManifest | null {
  const v = validateManifest(raw)
  if (!v.valid) {
    logger.warning('manifest 校验失败: %s', v.errors.join('; '))
    return null
  }
  return raw as PluginManifest
}

/**
 * 从文件加载并解析 manifest.json。
 *
 * 按约定读取 <pluginDir>/manifest.json。
 *
 * @param pluginDir 插件目录绝对路径
 * @returns 校验通过的 PluginManifest；文件缺失/解析失败/校验失败返回 null
 */
export function loadManifestFromFile(pluginDir: string): PluginManifest | null {
  try {
    const abs = path.resolve(pluginDir)
    const file = path.join(abs, 'manifest.json')
    if (!fs.existsSync(file)) {
      logger.debug('manifest.json 不存在，跳过: %s', file)
      return null
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return parseManifest(raw)
  } catch (e: any) {
    logger.warning('加载 manifest.json 失败 %s: %s', pluginDir, String(e?.message ?? e))
    return null
  }
}
