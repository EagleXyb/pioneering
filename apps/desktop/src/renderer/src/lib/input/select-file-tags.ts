// ============================================================
// select-file-tags — 文件/插件引用的标签语法层
// 对应 OpenCowork 文档 §5：三种标签语法（XML / 内联 Token / 插件）
// 本模块只负责「文本 <-> 标签」的解析与转换，不涉及文档模型。
// ============================================================

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
    // 插件内容通过 content 透传，外层（parseSelectFileText）再解析 payload
    matches.push({ index: m.index, end: m.index + m[0].length, type: 'plugin', content: m[1] ?? '' })
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
