// ============================================================
// select-file-tags — 文件/插件引用的标签语法层
// 对应 OpenCowork 文档 §5：三种标签语法（XML / 内联 Token / 插件）
// 本模块只负责「文本 <-> 标签」的解析与转换，不涉及文档模型。
// ============================================================

import type { ImageAttachment } from './image-attachments'

// ---- 标签正则 ----
const FILE_TAG_RE = /<select-file>([\s\S]*?)<\/select-file>/g
const PLUGIN_TAG_RE = /<select-plugin>([\s\S]*?)<\/select-plugin>/g
const FILE_TOKEN_RE = /@\{([^}]*)\}/g

// ---- 类型 ----
export type SelectFileSegmentType = 'text' | 'file' | 'plugin'

export interface SelectFileTextSegment {
  type: SelectFileSegmentType
  content: string
  /** file 段：文件路径 */
  filePath?: string
  /** plugin 段：解析后的 payload */
  plugin?: SelectPluginPayload
}

export interface SelectPluginPayload {
  pluginId: string
  label: string
  prompt: string
}

// ---- 创建标签 ----
export function createSelectFileTag(filePath: string): string {
  return `<select-file>${filePath}</select-file>`
}

export function createSelectFileToken(filePath: string): string {
  return `@{${filePath}}`
}

export function createSelectPluginTag(payload: SelectPluginPayload): string {
  return `<select-plugin>${JSON.stringify(payload)}</select-plugin>`
}

// ---- 解析 ----
interface RawMatch {
  index: number
  end: number
  type: 'file' | 'plugin'
  content: string
}

function collectMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  let m: RegExpExecArray | null

  FILE_TAG_RE.lastIndex = 0
  while ((m = FILE_TAG_RE.exec(text)) !== null) {
    matches.push({ index: m.index, end: m.index + m[0].length, type: 'file', content: m[1] ?? '' })
  }

  PLUGIN_TAG_RE.lastIndex = 0
  while ((m = PLUGIN_TAG_RE.exec(text)) !== null) {
    let payload: SelectPluginPayload | undefined
    try {
      payload = JSON.parse(m[1] ?? '{}') as SelectPluginPayload
    } catch {
      payload = undefined
    }
    matches.push({
      index: m.index,
      end: m.index + m[0].length,
      type: 'plugin',
      content: m[1] ?? '',
      // 通过 content 透传，外层再解析
      ...(payload ? {} : {})
    })
  }

  FILE_TOKEN_RE.lastIndex = 0
  while ((m = FILE_TOKEN_RE.exec(text)) !== null) {
    matches.push({ index: m.index, end: m.index + m[0].length, type: 'file', content: m[1] ?? '' })
  }

  return matches.sort((a, b) => a.index - b.index)
}

/**
 * 将含标签的文本解析为有序片段数组。
 * 文本段保留原样，file/plugin 段提取结构化信息。
 */
export function parseSelectFileText(text: string): SelectFileTextSegment[] {
  const matches = collectMatches(text)
  const segments: SelectFileTextSegment[] = []
  let cursor = 0

  for (const match of matches) {
    if (match.index > cursor) {
      segments.push({ type: 'text', content: text.slice(cursor, match.index) })
    }
    if (match.type === 'file') {
      segments.push({ type: 'file', content: match.content, filePath: match.content })
    } else {
      let payload: SelectPluginPayload | undefined
      try {
        payload = JSON.parse(match.content) as SelectPluginPayload
      } catch {
        payload = { pluginId: '', label: match.content, prompt: match.content }
      }
      segments.push({ type: 'plugin', content: match.content, plugin: payload })
    }
    cursor = match.end
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', content: text.slice(cursor) })
  }

  return segments
}

/** 查找光标位置所在的标签区间，返回匹配范围与内容（用于删除/高亮）。 */
export function findSelectFileTagAt(
  text: string,
  cursor: number
): { start: number; end: number; filePath?: string; plugin?: SelectPluginPayload } | null {
  const matches = collectMatches(text)
  for (const match of matches) {
    if (cursor >= match.index && cursor <= match.end) {
      if (match.type === 'file') {
        return { start: match.index, end: match.end, filePath: match.content }
      }
      let payload: SelectPluginPayload | undefined
      try {
        payload = JSON.parse(match.content) as SelectPluginPayload
      } catch {
        payload = undefined
      }
      return { start: match.index, end: match.end, plugin: payload }
    }
  }
  return null
}

/**
 * 计算 `@` 触发的文件搜索查询。
 * 算法（对应文档 §5.4）：
 *   - 向左搜索，遇到空白字符视为无有效触发
 *   - 若 `@` 后紧跟 `{`，说明已在 @{} 内部，返回 null
 *   - 若 `@` 前是字母/数字/下划线/点/斜杠，说明不是单独的 @，返回 null
 *   - 否则返回 { start, end, query }
 */
export function getSelectFileMentionQuery(
  text: string,
  cursor: number
): { start: number; end: number; query: string } | null {
  const before = text.slice(0, cursor)
  const atIndex = before.lastIndexOf('@')
  if (atIndex === -1) return null

  const prevChar = atIndex > 0 ? before[atIndex - 1] : ''
  if (prevChar && /[A-Za-z0-9_./\\]/.test(prevChar)) return null

  const between = before.slice(atIndex + 1)
  if (/[\s<>}]/.test(between)) return null

  return { start: atIndex, end: cursor, query: between }
}

/** 移除所有标签，仅保留纯文本。 */
export function selectFileTextToPlainText(text: string): string {
  return parseSelectFileText(text)
    .map((seg) => (seg.type === 'text' ? seg.content : ''))
    .join('')
}

/** 统一转为 `@{}` 内联 Token 格式（文件标签 <-> 内联 Token）。 */
export function normalizeSelectFileText(text: string): string {
  let out = text.replace(FILE_TAG_RE, (_full, p1: string) => `@{${p1}}`)
  // 插件标签保持不变
  return out
}

/** 统一转为 `<select-file>` XML 格式（用于发送给后端）。 */
export function serializeSelectFileText(text: string): string {
  let out = text.replace(FILE_TOKEN_RE, (_full, p1: string) => `<select-file>${p1}</select-file>`)
  return out
}

/** 文本是否包含任意文件引用标签。 */
export function hasSelectFileTag(text: string): boolean {
  return FILE_TAG_RE.test(text) || FILE_TOKEN_RE.test(text)
}

/** 是否存在任意插件引用标签。 */
export function hasSelectPluginTag(text: string): boolean {
  return PLUGIN_TAG_RE.test(text)
}

/** 提取所有文件引用路径（去重，保留顺序）。 */
export function extractFilePaths(text: string): string[] {
  const paths: string[] = []
  for (const seg of parseSelectFileText(text)) {
    if (seg.type === 'file' && seg.filePath && !paths.includes(seg.filePath)) {
      paths.push(seg.filePath)
    }
  }
  return paths
}

/** 从序列化文本中移除指定文件路径的引用（用于删除文件引用）。 */
export function removeFilePathFromText(text: string, filePath: string): string {
  const token = createSelectFileToken(filePath)
  const tag = createSelectFileTag(filePath)
  let out = text.split(token).join('')
  out = out.split(tag).join('')
  // 清理可能残留的连续空白
  return out.replace(/\s{2,}/g, ' ').trim()
}

// ---- 与图片附件的交互（供发送构建）----
export type SendImages = ImageAttachment[]
