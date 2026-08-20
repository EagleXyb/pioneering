// memory-md-persistence.ts
//
// P2（文档 4.3 建议8 / 4.4-P2）落地项：MEMORY.md 持久化。
//
// 把长期记忆 / 经验沉淀为 Markdown（MEMORY.md 范式，对齐 Hermes 的
// "Markdown 既是配置也是学习产物"），支持读/写。
//
// 设计约束（严守"不修改原有业务逻辑、不引入新缺陷"）：
//   - 纯增强、无副作用：宿主显式调用写/读；不接入 InMemoryShortTermMemory
//     等既有记忆实现，也不改变任何运行时行为。
//   - 文件缺失/解析失败一律返回空结果，不抛异常。
//   - 序列化格式：可选 YAML frontmatter（元数据）+ 分节正文，人类可读、可 diff。

import fs from 'fs'
import path from 'path'
import { parseYamlSubset } from './yaml-loader.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[config.memory_md] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[config.memory_md] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[config.memory_md] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[config.memory_md] ${msg}`, ...args),
}

/** 单条记忆条目（用于持久化）。 */
export interface MemoryEntry {
  /** 记忆内容 */
  content: string
  /** 可选的分类/标签（如 'lesson' | 'preference' | 'fact'） */
  category?: string
  /** 时间戳（秒） */
  timestamp?: number
  /** 任意附加元数据 */
  [key: string]: any
}

/** MEMORY.md 文档结构。 */
export interface MemoryMarkdownDoc {
  /** 元信息（frontmatter） */
  meta: Record<string, any>
  /** 记忆条目列表 */
  entries: MemoryEntry[]
  /** 源文件绝对路径 */
  source: string
}

/**
 * 把记忆条目序列化为 MEMORY.md 文本。
 *
 * 格式约定：
 *   ---
 *   title: 长期记忆
 *   updated: <timestamp>
 *   ---
 *   ## 记忆
 *
 *   ### 0
 *   category: lesson
 *   timestamp: 123456
 *   内容正文...
 *
 * @param meta 文档元信息（可选）
 * @param entries 记忆条目
 * @returns Markdown 文本
 */
export function serializeMemoryToMarkdown(
  meta: Record<string, any>,
  entries: MemoryEntry[],
): string {
  const lines: string[] = []
  lines.push('---')
  const fm: Record<string, any> = { title: '长期记忆', ...meta }
  if (!fm.updated && entries.length > 0) {
    const maxTs = Math.max(...entries.map((e) => e.timestamp ?? 0))
    if (maxTs > 0) fm.updated = maxTs
  }
  for (const [k, v] of Object.entries(fm)) {
    lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  }
  lines.push('---')
  lines.push('')
  lines.push('## 记忆')
  lines.push('')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    lines.push(`### ${i}`)
    // 元数据行
    const metaPairs: Array<[string, any]> = []
    for (const [k, v] of Object.entries(e)) {
      if (k === 'content') continue
      metaPairs.push([k, v])
    }
    for (const [k, v] of metaPairs) {
      lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
    lines.push('')
    lines.push(String(e.content ?? '').trim())
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * 解析 MEMORY.md 文本为 MemoryMarkdownDoc。
 *
 * 兼容 serializeMemoryToMarkdown 的输出格式；也接受不带 frontmatter 的简单格式
 * （整篇视为单条 entry 的 content，或按 `### N` 分节）。
 *
 * @param text Markdown 文本
 * @param source 源文件路径（用于诊断）
 * @returns 解析结果；解析失败返回空条目（不抛异常）
 */
export function parseMemoryFromMarkdown(text: string, source: string): MemoryMarkdownDoc {
  const trimmed = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  let body = trimmed
  let meta: Record<string, any> = {}

  // 解析 frontmatter
  if (trimmed.startsWith('---')) {
    const nl = trimmed.indexOf('\n')
    const endMarker = trimmed.indexOf('\n---', nl + 1)
    if (endMarker !== -1) {
      const fmText = trimmed.slice(nl + 1, endMarker)
      try {
        meta = parseYamlSubset(fmText) ?? {}
      } catch (e: any) {
        logger.warning('MEMORY.md frontmatter 解析失败，忽略元信息: %s', String(e?.message ?? e))
        meta = {}
      }
      body = trimmed.slice(endMarker + 5).trim()
    }
  }

  const entries: MemoryEntry[] = parseSections(body)

  return { meta, entries, source }
}

/** 按 `### <n>` 分节解析记忆条目。 */
function parseSections(body: string): MemoryEntry[] {
  if (!body || body.trim() === '') return []
  const lines = body.split('\n')

  // 判断是否含 `### <n>` 分节
  const hasSections = lines.some((l) => /^###\s+\d+\s*$/.test(l.trim()))

  // 无分节：整篇正文作为单条记忆（含元数据行解析）
  if (!hasSections) {
    const entry: MemoryEntry = { content: '' }
    const contentLines: string[] = []
    for (const line of lines) {
      const metaMatch = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(line.trim())
      // 仅把"首个非空行"之前的 key:value 当元数据；其余视为正文
      if (metaMatch && contentLines.length === 0) {
        const [, k, vRaw] = metaMatch
        entry[k] = parseMetaValue(vRaw)
      } else {
        contentLines.push(line)
      }
    }
    entry.content = contentLines.join('\n').trim()
    if (entry.content === '' && Object.keys(entry).every((k) => k === 'content')) {
      // 全空（只有元数据无正文）——不产生空记忆
      return []
    }
    return [entry]
  }

  // 含分节：严格按 `### <n>` 解析，忽略分节之外的标题/空行
  const entries: MemoryEntry[] = []
  let current: { contentLines: string[]; meta: Record<string, any> } | null = null

  const flush = (): void => {
    if (!current) return
    const entry: MemoryEntry = {
      ...current.meta,
      content: current.contentLines.join('\n').trim(),
    }
    entries.push(entry)
    current = null
  }

  for (const line of lines) {
    if (/^###\s+\d+\s*$/.test(line.trim())) {
      flush()
      current = { contentLines: [], meta: {} }
      continue
    }
    if (!current) {
      // 分节标题之前的标题/空行（如 `## 记忆`）忽略
      continue
    }
    const metaMatch = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(line.trim())
    if (metaMatch && current.contentLines.length === 0) {
      const [, k, vRaw] = metaMatch
      current.meta[k] = parseMetaValue(vRaw)
    } else {
      current.contentLines.push(line)
    }
  }
  flush()

  return entries
}

function parseMetaValue(raw: string): any {
  const s = raw.trim()
  if (s === '') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  return s
}

/**
 * 把记忆条目写入 MEMORY.md 文件（原子写：先写临时文件再重命名）。
 *
 * @param filePath 目标文件路径
 * @param meta 文档元信息
 * @param entries 记忆条目
 * @returns 是否写入成功；写入失败返回 false（不抛异常）
 */
export function writeMemoryToMarkdownFile(
  filePath: string,
  meta: Record<string, any>,
  entries: MemoryEntry[],
): boolean {
  try {
    const text = serializeMemoryToMarkdown(meta, entries)
    const abs = path.resolve(filePath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.tmp-${Date.now()}`
    fs.writeFileSync(tmp, text, 'utf-8')
    fs.renameSync(tmp, abs)
    return true
  } catch (e: any) {
    logger.warning('写入 MEMORY.md 失败 %s: %s', filePath, String(e?.message ?? e))
    return false
  }
}

/**
 * 读取 MEMORY.md 文件。
 *
 * @param filePath 文件路径
 * @returns MemoryMarkdownDoc；文件缺失/解析失败返回空条目（不抛异常）
 */
export function readMemoryFromMarkdownFile(filePath: string): MemoryMarkdownDoc {
  try {
    const abs = path.resolve(filePath)
    if (!fs.existsSync(abs)) {
      return { meta: {}, entries: [], source: abs }
    }
    const text = fs.readFileSync(abs, 'utf-8')
    return parseMemoryFromMarkdown(text, abs)
  } catch (e: any) {
    logger.warning('读取 MEMORY.md 失败 %s: %s', filePath, String(e?.message ?? e))
    return { meta: {}, entries: [], source: path.resolve(filePath) }
  }
}
