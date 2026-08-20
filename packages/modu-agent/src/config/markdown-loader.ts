// markdown-loader.ts
//
// P1（文档 4.3 / 4.4-P1）落地项：Markdown 文档配置加载层。
//
// 职责：
//   1. 按约定文件名扫描项目根目录的 `.md` 配置文档：
//        AGENTS.md   → 行为准则 / 工作流 SOP（注入 system_prompt）
//        SOUL.md     → 人格 / 语气 / 边界（注入 system_prompt）
//        USER.md     → 用户画像（注入 runtime_context）
//        MEMORY.md   → 长期记忆 / 经验（按需加载，默认 lazy）
//   2. 解析每个文档的 YAML frontmatter 与正文，输出结构化 MarkdownDoc。
//   3. 支持领域适配目录 config/domains/<domain>.md（见 loadDomainsFromMarkdown）。
//
// 设计约束（严守"不修改原有业务逻辑、不引入新缺陷"）：
//   - 纯增强层：目录/文件缺失、frontmatter 非法一律返回空结果，不抛异常。
//   - 默认不改变任何既有 prompt 行为；注入由上层显式开启（gated）。
//   - 复用 yaml-loader 的最小 YAML 子集解析器解析 frontmatter，零外部依赖。
//   - 注入目标 inject_to 支持 system_prompt | runtime_context | none。

import fs from 'fs'
import path from 'path'
import { parseYamlSubset } from './yaml-loader.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[config.markdown] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[config.markdown] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[config.markdown] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[config.markdown] ${msg}`, ...args),
}

/** frontmatter 支持的注入目标 */
export type MarkdownInjectTarget = 'system_prompt' | 'runtime_context' | 'none'

/**
 * 层级 cascade 级别（对应文档 4.5 风险①「AGENTS.md 分层级 cascade」）。
 * 级别越小越"底层/全局"，越大越"上层/具体"；聚合时按此顺序级联叠加。
 */
export type CascadeLevel = 'global' | 'project' | 'user'

/** 层级顺序（用于 cascade 排序，索引越小越靠前） */
export const CASCADE_LEVEL_ORDER: readonly CascadeLevel[] = ['global', 'project', 'user']

/** Markdown 文档元信息 */
export interface MarkdownMeta {
  /** 注入目标；缺省由文档类型决定（AGENTS/SOUL→system_prompt，USER/MEMORY→runtime_context） */
  inject_to?: MarkdownInjectTarget
  /** 加载方式：eager=常驻，lazy=按需（MEMORY 默认 lazy） */
  load?: 'eager' | 'lazy'
  /** 优先级（数值越大越靠前，可选） */
  priority?: number
  /** 角色标识（可选，如领域名） */
  role?: string
  /** 层级 cascade 级别（可选，仅 frontmatter 显式声明时生效） */
  cascade_level?: CascadeLevel
  /** 是否参与 cascade 级联（可选，仅 frontmatter 显式声明时生效） */
  cascade?: boolean
  /** 其余 frontmatter 字段原样保留，供领域适配等扩展使用 */
  [key: string]: any
}

/** 解析后的 Markdown 配置文档 */
export interface MarkdownDoc {
  /** 文档名（不含扩展名，如 AGENTS / SOUL / USER / MEMORY） */
  name: string
  /** 正文内容（去除 frontmatter 后，已 trim） */
  content: string
  /** 元信息 */
  meta: MarkdownMeta
  /** 最终注入目标（meta.inject_to ?? 按类型推断） */
  injectTo: MarkdownInjectTarget
  /** 源文件绝对路径 */
  source: string
}

/** 约定文档名 → 默认注入目标 映射 */
const CONVENTIONAL_DOCS: Record<string, MarkdownInjectTarget> = {
  AGENTS: 'system_prompt',
  SOUL: 'system_prompt',
  USER: 'runtime_context',
  MEMORY: 'runtime_context',
}

/** 约定文档名 → 默认加载方式（4.5 风险①：MEMORY 按需加载，默认 lazy；其余 eager 常驻） */
const DEFAULT_LOAD: Record<string, 'eager' | 'lazy'> = {
  AGENTS: 'eager',
  SOUL: 'eager',
  USER: 'eager',
  MEMORY: 'lazy',
}

/** 项目根目录（packages/modu-agent）。 */
export function getPackageRoot(): string {
  return path.resolve(__dirname, '..', '..')
}

/**
 * 从 frontmatter YAML 文本解析为元信息对象。
 * 解析失败返回空对象（不抛异常，走降级）。
 */
export function parseFrontmatter(text: string): MarkdownMeta {
  if (!text || text.trim() === '') return {}
  try {
    const parsed = parseYamlSubset(text)
    return (parsed ?? {}) as MarkdownMeta
  } catch (e: any) {
    logger.warning('frontmatter 解析失败，忽略其元信息: %s', String(e?.message ?? e))
    return {}
  }
}

/**
 * 解析单个 Markdown 文件内容为 MarkdownDoc。
 *
 * 格式约定：
 *   ---
 *   inject_to: system_prompt
 *   load: eager
 *   ---
 *   正文内容...
 *
 * 无 frontmatter（不以 `---` 开头）时，整篇视为正文。
 *
 * @param content 文件文本
 * @param name 文档名（不含扩展名）
 * @param source 源文件路径
 * @returns MarkdownDoc；正文为空时返回 null
 */
export function parseMarkdownDoc(content: string, name: string, source: string): MarkdownDoc | null {
  const trimmed = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  let body = trimmed
  let meta: MarkdownMeta = {}

  // 检测 YAML frontmatter：以 --- 开头，且存在第二个 --- 行
  if (trimmed.startsWith('---')) {
    const nl = trimmed.indexOf('\n')
    const endMarker = trimmed.indexOf('\n---', nl + 1)
    if (endMarker !== -1) {
      const fmText = trimmed.slice(nl + 1, endMarker)
      meta = parseFrontmatter(fmText)
      body = trimmed.slice(endMarker + 5).trim()
    } else {
      body = trimmed
    }
  }

  if (!body || body.trim() === '') {
    return null
  }

  const injectTo = meta.inject_to ?? CONVENTIONAL_DOCS[name] ?? 'system_prompt'
  const load = meta.load ?? DEFAULT_LOAD[name] ?? 'eager'
  // 4.5 风险①「层级 cascade」：cascade_level / cascade 仅在 frontmatter 显式提供时才生效；
  // 未显式声明时不设置（保持 undefined），以维持既有 priority 排序语义（向后兼容）。
  const effectiveMeta: MarkdownMeta = { ...meta, inject_to: injectTo, load }

  return {
    name,
    content: body.trim(),
    meta: effectiveMeta,
    injectTo,
    source,
  }
}

/**
 * 查找项目根目录中的约定 `.md` 配置文档。
 * 返回 [{ name, absPath }]；不存在的自动跳过。
 */
export function findConventionalMarkdownDocs(rootDir?: string): Array<{ name: string; absPath: string }> {
  const root = rootDir ?? getPackageRoot()
  const out: Array<{ name: string; absPath: string }> = []
  const names = Object.keys(CONVENTIONAL_DOCS)
  for (const name of names) {
    const abs = path.join(root, `${name}.md`)
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      out.push({ name, absPath: abs })
    }
  }
  return out
}

/**
 * 加载全部约定 `.md` 配置文档。
 *
 * @param opts.rootDir 项目根目录（默认 getPackageRoot()）
 * @param opts.onlyLoad 'eager' | 'lazy' | undefined —— 仅加载指定 load 类型的文档；
 *                      未指定则加载全部（lazy 文档也返回，由调用方决定是否使用）
 * @returns MarkdownDoc[]；无文件/解析失败返回空数组（不抛异常）
 */
export function loadMarkdownDocs(
  opts: { rootDir?: string; onlyLoad?: 'eager' | 'lazy' } = {},
): MarkdownDoc[] {
  const root = opts.rootDir ?? getPackageRoot()
  const found = findConventionalMarkdownDocs(root)
  const docs: MarkdownDoc[] = []
  for (const { name, absPath } of found) {
    try {
      const raw = fs.readFileSync(absPath, 'utf-8')
      const doc = parseMarkdownDoc(raw, name, absPath)
      if (!doc) continue
      if (opts.onlyLoad && doc.meta.load !== opts.onlyLoad) continue
      docs.push(doc)
    } catch (e: any) {
      // 单文档失败隔离
      logger.warning('加载 %s 失败，跳过: %s', absPath, String(e?.message ?? e))
    }
  }
  return docs
}

// ============================================================
// 领域适配：config/domains/<domain>.md → DomainAdapter
// ============================================================

/**
 * 将 MarkdownDoc 解析为领域适配器结构。
 *
 * frontmatter 可承载领域配置：
 *   ---
 *   domain_context: 你是金融分析领域的专业Agent
 *   terminology:
 *     ROE: 净资产收益率
 *     P/E: 市盈率
 *   reasoning_patterns:
 *     - 先看营收增速，再看利润率
 *   output_requirements: 数值结果保留2位小数
 *   ---
 *
 * 若 frontmatter 中无结构化字段，则将正文作为 domain_context 兜底。
 *
 * @param doc 已解析的 Markdown 文档
 * @returns DomainAdapter（字段缺省时空值）
 */
export function docToDomainAdapter(doc: MarkdownDoc): {
  domain_context: string
  terminology?: Record<string, string>
  reasoning_patterns?: string[]
  output_requirements?: string
} {
  const m = doc.meta
  const adapter: {
    domain_context: string
    terminology?: Record<string, string>
    reasoning_patterns?: string[]
    output_requirements?: string
  } = {
    domain_context: typeof m.domain_context === 'string' && m.domain_context
      ? m.domain_context
      : doc.content,
  }
  if (m.terminology && typeof m.terminology === 'object') {
    adapter.terminology = m.terminology as Record<string, string>
  }
  if (Array.isArray(m.reasoning_patterns)) {
    adapter.reasoning_patterns = (m.reasoning_patterns as unknown[]).map(String)
  }
  if (typeof m.output_requirements === 'string' && m.output_requirements) {
    adapter.output_requirements = m.output_requirements
  }
  return adapter
}

/**
 * 从 config/domains 目录批量加载领域适配。
 *
 * 约定：<rootDir>/config/domains/<domain>.md
 *   其中 <domain> 为领域标识（如 financial_analysis.md → domain='financial_analysis'）。
 *
 * @param opts.rootDir 项目根目录（默认 getPackageRoot()）
 * @returns [{ domain, adapter }]；目录不存在/无文件返回空数组（不抛异常）
 */
export function loadDomainAdaptersFromMarkdown(
  opts: { rootDir?: string } = {},
): Array<{ domain: string; adapter: {
  domain_context: string
  terminology?: Record<string, string>
  reasoning_patterns?: string[]
  output_requirements?: string
} }> {
  const root = opts.rootDir ?? getPackageRoot()
  const dir = path.join(root, 'config', 'domains')
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return []
  }
  const out: Array<{ domain: string; adapter: {
    domain_context: string
    terminology?: Record<string, string>
    reasoning_patterns?: string[]
    output_requirements?: string
  } }> = []
  const entries = fs.readdirSync(dir).sort()
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const abs = path.join(dir, entry)
    if (!fs.statSync(abs).isFile()) continue
    const domain = entry.slice(0, -'.md'.length)
    try {
      const raw = fs.readFileSync(abs, 'utf-8')
      const doc = parseMarkdownDoc(raw, domain, abs)
      if (!doc) continue
      out.push({ domain, adapter: docToDomainAdapter(doc) })
    } catch (e: any) {
      logger.warning('加载领域适配 %s 失败，跳过: %s', abs, String(e?.message ?? e))
    }
  }
  return out
}
