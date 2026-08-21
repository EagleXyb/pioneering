// yaml-loader.ts
//
// P0（文档 4.4）落地项：新增 config.yaml 分层加载能力。
//
// 设计约束（严守"不改业务逻辑、不引入缺陷"）：
//   1. 零外部依赖：内置一个最小、安全的 YAML 子集解析器，仅解析本项目
//      config.yaml 实际用到的语法（嵌套 map、块列表、标量、注释、引号），
//      避免引入 js-yaml 等第三方依赖带来的安装/体积/兼容性风险。
//   2. 纯增强层：仅在 MODU_CONFIG_PATH 未显式指定时才会被 getConfig 调用，
//      解析失败或文件缺失一律降级到内置 DEFAULT_CONFIG（fromEnv 链路），
//      与现状行为完全等价。
//   3. 不修改 DEFAULT_CONFIG 既有字段语义，仅在其之上做"深度合并覆盖"。
//
// 对应 Python 侧的 yaml 配置文件加载思路，但此处以最小实现落地。

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'

// ESM 下无全局 __dirname（package.json 为 "type": "module"），按需以 import.meta.url 推导
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[config] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[config] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[config] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[config] ${msg}`, ...args),
}

// ============================================================
// 查找 config.yaml
// ============================================================

/**
 * 在项目根目录（packages/modu-agent）查找 config.yaml。
 * 返回绝对路径；不存在则返回 null。
 */
export function findConfigYaml(): string | null {
  // 以本文件所在目录（src/config）上溯两级到包根
  const pkgRoot = path.resolve(__dirname, '..', '..')
  const candidates = [
    path.join(pkgRoot, 'config.yaml'),
    path.join(pkgRoot, 'config.yml'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

// ============================================================
// 最小 YAML 子集解析器（缩进分块 + 递归构建）
// ============================================================
//
// 支持的语法（覆盖本仓库 config.yaml 的写法）：
//   - 以 2 空格为缩进单位的嵌套 map
//   - 块列表：- item  或   - key: value（列表项为 map，可继续嵌套）
//   - 标量：裸字符串、单/双引号字符串、数字、true/false、null(~ / 空)
//   - 行内注释（# 且不在引号内）
//   - key: value 形式
//
// 不支持（也不应在配置文件中使用）：多文档、锚点/别名、复杂流样式、
//   多行文本块（| 或 >）等。遇到无法识别的结构会抛出，由上层降级处理。

function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i)
    }
  }
  return line
}

function parseScalar(raw: string): any {
  const s = raw.trim()
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') {
    return null
  }
  if (s === 'true' || s === 'True' || s === 'TRUE') return true
  if (s === 'false' || s === 'False' || s === 'FALSE') return false
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1)
  }
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  return s
}

interface RawLine {
  indent: number
  text: string // 已去注释、已 trim 的内容
  isListItem: boolean
}

function preprocess(text: string): RawLine[] {
  const out: RawLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const trimmedRight = raw.replace(/\s+$/, '')
    if (trimmedRight.trim() === '') continue
    const indent = raw.length - raw.trimStart().length
    // 去掉前导缩进与尾随空白，仅保留相对内容（indent 已单独记录）
    const content = stripComment(trimmedRight).trim()
    if (content === '') continue
    const isListItem = content.startsWith('- ')
    out.push({ indent, text: content, isListItem })
  }
  return out
}

/**
 * 解析 YAML 子集文本为 JS 对象。
 * 采用递归下降：根据缩进把行划分为"块"，块要么是 map 要么是 list。
 */
export function parseYamlSubset(text: string): Record<string, any> {
  const lines = preprocess(text)
  if (lines.length === 0) return {}
  const [root] = parseBlock(lines, 0, lines[0].indent)
  return root
}

/**
 * 从 lines[start] 开始，解析一个"块"。该块所有直接子行的缩进必须 > baseIndent。
 * 返回 [解析结果, 下一个块的起始索引]。
 */
function parseBlock(lines: RawLine[], start: number, baseIndent: number): [any, number] {
  // 判断该块是 list 还是 map：看第一个直接子元素
  const first = lines[start]
  const childIndent = first.indent

  if (first.isListItem) {
    // 列表块
    const arr: any[] = []
    let i = start
    while (i < lines.length && lines[i].indent === childIndent && lines[i].isListItem) {
      const itemContent = lines[i].text.slice(2) // 去掉 "- "
      const colonIdx = itemContent.indexOf(':')
      if (colonIdx > 0) {
        // 列表项是一个 map：把当前行就地改写为"去掉 - 前缀、缩进 +2"的普通
        // map 首行（itemContent 实际起始列 = 原缩进 + 2），再交由 map 分支递归
        // 解析。这样列表项内的兄弟键（如 `when:` 与同缩进的 `route:`）以及嵌套
        // 值都能被正确纳入同一个对象，且不会产生无限递归。
        lines[i] = { indent: childIndent + 2, text: itemContent, isListItem: false }
        const [mapObj, next] = parseBlock(lines, i, childIndent + 2)
        arr.push(mapObj)
        i = next
      } else {
        // 纯标量列表项
        arr.push(parseScalar(itemContent))
        i++
      }
    }
    return [arr, i]
  }

  // map 块
  const obj: Record<string, any> = {}
  let i = start
  while (i < lines.length && lines[i].indent === childIndent && !lines[i].isListItem) {
    const content = lines[i].text
    const colonIdx = content.indexOf(':')
    if (colonIdx <= 0) {
      throw new Error(`yaml-loader: 无法解析行: "${content}"`)
    }
    const key = content.slice(0, colonIdx).trim()
    const inlineVal = content.slice(colonIdx + 1).trim()
    if (inlineVal === '') {
      // 值可能嵌套在更深缩进；也可能就是 null（无更深行）
      if (i + 1 < lines.length && lines[i + 1].indent > childIndent) {
        const [val, next] = parseBlock(lines, i + 1, lines[i + 1].indent)
        obj[key] = val
        i = next
      } else {
        obj[key] = null
        i++
      }
    } else {
      obj[key] = parseScalar(inlineVal)
      i++
    }
  }
  return [obj, i]
}

// ============================================================
// 加载 + 深度合并
// ============================================================

/**
 * 读取并解析 config.yaml；失败时（文件缺失/解析错误）返回 null，
 * 由调用方降级到内置 DEFAULT_CONFIG。
 */
export function loadConfigYaml(filePath?: string): Record<string, any> | null {
  const p = filePath ?? findConfigYaml()
  if (!p) {
    return null
  }
  if (!fs.existsSync(p)) {
    return null
  }
  try {
    const text = fs.readFileSync(p, 'utf-8')
    const parsed = parseYamlSubset(text)
    return parsed
  } catch (e: any) {
    logger.warning('解析 config.yaml 失败，降级使用内置默认配置: %s', String(e?.message ?? e))
    return null
  }
}

/**
 * 将 override 深度合并到 base（返回 base 本身，原地合并）。
 * 与 RuntimeConfig._deepMerge 语义一致：对象递归合并、数组/标量覆盖。
 */
export function deepMergeConfig(
  base: Record<string, any>,
  override: Record<string, any>,
): Record<string, any> {
  for (const [key, value] of Object.entries(override)) {
    if (
      key in base &&
      base[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key]) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      deepMergeConfig(base[key], value)
    } else {
      base[key] = value
    }
  }
  return base
}

// ============================================================
// 类型安全校验（对应文档 4.5 风险②「类型安全」）
// ============================================================
//
// YAML 覆盖值需与 DEFAULT_CONFIG 中对应字段类型一致，否则丢弃并告警，
// 避免"环境层误写静默失效"（借鉴 Trae 的 int 强校验）。
//
// 校验规则：
//   - 仅校验 override 中**已存在于 base** 的键（新增键不做类型假设，放行）。
//   - 标量类型必须一致（string/number/boolean），不符则丢弃该键。
//   - null 值放行（视为"显式置空"，业务上等价于未覆盖）。
//   - 对象/数组递归校验；类型不同（如 base 是对象、override 是标量）则丢弃整个键。

export interface TypeValidationResult {
  /** 清洗后、类型合法的配置对象 */
  cleaned: Record<string, any>
  /** 因类型不符被丢弃的字段（点分路径） */
  droppedKeys: string[]
}

function sameScalarType(a: any, b: any): boolean {
  return typeof a === typeof b
}

/**
 * 对照 base 递归校验并清洗 override，丢弃类型不符的字段。
 *
 * @param base 基准配置（通常为 DEFAULT_CONFIG 的深拷贝）
 * @param override 待校验的 YAML 覆盖配置
 * @param pathPrefix 点分路径前缀（内部递归用）
 * @returns 清洗结果（cleaned 与 droppedKeys）
 */
function validateAgainstBase(
  base: Record<string, any>,
  override: Record<string, any>,
  pathPrefix = '',
): TypeValidationResult {
  const cleaned: Record<string, any> = {}
  const droppedKeys: string[] = []

  for (const [key, value] of Object.entries(override)) {
    const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key

    // 新增键（base 中不存在）：放行，不做类型假设
    if (!(key in base)) {
      cleaned[key] = value
      continue
    }

    const baseVal = base[key]

    // 值类型不一致且非 null：丢弃
    if (value === null || value === undefined) {
      // 显式置空：放行
      cleaned[key] = value
      continue
    }

    if (Array.isArray(value) && Array.isArray(baseVal)) {
      // 数组：直接放行（元素级校验过于激进，且 config.yaml 中数组较少）
      cleaned[key] = value
      continue
    }

    if (
      typeof value === 'object' &&
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(value) &&
      !Array.isArray(baseVal)
    ) {
      // 嵌套对象：递归校验
      const sub = validateAgainstBase(baseVal, value, fullPath)
      cleaned[key] = sub.cleaned
      droppedKeys.push(...sub.droppedKeys)
      continue
    }

    if (sameScalarType(baseVal, value)) {
      cleaned[key] = value
    } else {
      // 类型不符：丢弃并记录
      droppedKeys.push(fullPath)
      logger.warning(
        '[type-safety] 丢弃类型不符的配置字段 %s：期望 %s，实际 %s',
        fullPath,
        typeof baseVal,
        typeof value,
      )
    }
  }

  return { cleaned, droppedKeys }
}

/**
 * 加载 config.yaml 并做类型安全校验。
 *
 * 与 loadConfigYaml 的区别：本函数在解析后对照 base 校验类型，
 * 返回 { cleaned, droppedKeys }；解析失败/文件缺失返回 null。
 *
 * @param filePath 可选文件路径（默认 findConfigYaml()）
 * @param base 类型基准（默认 DEFAULT_CONFIG 由调用方传入）
 * @returns 校验结果；文件缺失/解析失败返回 null
 */
export function loadConfigYamlValidated(
  base: Record<string, any>,
  filePath?: string,
): TypeValidationResult | null {
  const p = filePath ?? findConfigYaml()
  if (!p || !fs.existsSync(p)) {
    return null
  }
  try {
    const text = fs.readFileSync(p, 'utf-8')
    const parsed = parseYamlSubset(text)
    const result = validateAgainstBase(base, parsed)
    if (result.droppedKeys.length > 0) {
      logger.warning(
        '[type-safety] config.yaml 校验完成：%d 个字段因类型不符被丢弃，采用内置默认值',
        result.droppedKeys.length,
      )
    }
    return result
  } catch (e: any) {
    logger.warning('解析 config.yaml 失败，降级使用内置默认配置: %s', String(e?.message ?? e))
    return null
  }
}
