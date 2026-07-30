// ============================================================
// embedded-tool-results — 工具结果识别与渲染工具
//
// 功能：
//   1. 从AI正文中提取嵌入的工具结果JSON（extractEmbeddedToolResults）
//   2. 识别结果类型：search / datetime / generic
//   3. 提供favicon颜色/字母工具
//
// ObservationResult（timeline路径）和 EmbeddedToolResultCard（正文路径）
// 共享本模块的分类逻辑，保证两处渲染行为一致。
// ============================================================

// ---- 结果类型定义 ----

export interface SearchResultItem {
  title: string
  url?: string
  snippet?: string
  source?: string
}

export interface SearchResultData {
  kind: 'search'
  results: SearchResultItem[]
  source?: string
  query?: string
}

export interface DatetimeResultData {
  kind: 'datetime'
  datetime: string
  timezone?: string
}

export interface GenericResultData {
  kind: 'generic'
  parsed: unknown
  summary: string
}

export type ParsedToolResult = SearchResultData | DatetimeResultData | GenericResultData

// ---- 提取正文段 ----

export interface TextSegment { type: 'text'; content: string }
export interface ToolResultSegment { type: 'toolResult'; raw: string; parsed: unknown }
export type ContentSegment = TextSegment | ToolResultSegment

function findJsonObjectEnd(s: string, start: number): number {
  if (s[start] !== '{') return -1
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return i + 1 }
  }
  return -1
}

function isToolResultJson(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const o = obj as Record<string, unknown>
  const hasStatus = typeof o.status === 'string' &&
    ['success', 'error', 'completed', 'failed'].includes(o.status)
  const hasData = 'data' in o
  const hasTool = 'tool' in o
  return hasStatus && (hasData || hasTool)
}

export function extractEmbeddedToolResults(text: string): ContentSegment[] {
  if (!text) return [{ type: 'text', content: '' }]
  const segments: ContentSegment[] = []
  let textStart = 0, i = 0
  while (i < text.length) {
    if (text[i] === '{') {
      const end = findJsonObjectEnd(text, i)
      if (end !== -1) {
        const raw = text.slice(i, end)
        let parsed: unknown = null, isTool = false
        try { parsed = JSON.parse(raw); isTool = isToolResultJson(parsed) } catch { isTool = false }
        if (isTool) {
          if (i > textStart) segments.push({ type: 'text', content: text.slice(textStart, i) })
          segments.push({ type: 'toolResult', raw, parsed })
          textStart = end; i = end; continue
        } else { i = end; continue }
      }
    }
    i++
  }
  if (textStart < text.length) segments.push({ type: 'text', content: text.slice(textStart) })
  return segments.filter((s) => s.type !== 'text' || s.content.length > 0)
}

// ---- 结果分类 ----

function tryParse(s: string): unknown | null {
  try { return JSON.parse(s) } catch { return null }
}

export function classifyToolResult(parsed: unknown): ParsedToolResult | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const data = (obj.data && typeof obj.data === 'object') ? obj.data as Record<string, unknown> : obj

  // 搜索结果
  if (Array.isArray(data.results) && data.results.length > 0) {
    const first = data.results[0]
    if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).title === 'string') {
      return {
        kind: 'search',
        results: data.results as SearchResultItem[],
        source: typeof data.source === 'string' ? data.source : undefined,
        query: typeof data.query === 'string' ? data.query : undefined,
      }
    }
  }
  if (Array.isArray(obj.results) && obj.results.length > 0) {
    const first = obj.results[0]
    if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).title === 'string') {
      return {
        kind: 'search',
        results: obj.results as SearchResultItem[],
        source: typeof obj.source === 'string' ? obj.source : undefined,
      }
    }
  }

  // 时间结果
  if (typeof data.datetime === 'string') {
    return {
      kind: 'datetime',
      datetime: data.datetime,
      timezone: typeof data.timezone === 'string' ? data.timezone : undefined,
    }
  }

  return null
}

export function classifyRawResult(raw: string): { parsed: unknown; classified: ParsedToolResult | null } {
  const parsed = tryParse(raw)
  if (parsed === null) return { parsed: null, classified: null }
  return { parsed, classified: classifyToolResult(parsed) }
}

export function genericResultSummary(parsed: unknown, raw: string): string {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>
    if (o.status === 'success' || o.status === 'completed') return '调用成功'
    if (o.status === 'error' || o.status === 'failed') {
      const msg = typeof o.message === 'string' ? o.message : typeof o.error === 'string' ? (o.error as string) : ''
      return msg ? `调用失败: ${msg}` : '调用失败'
    }
    if (typeof o.summary === 'string') return (o.summary as string).slice(0, 120)
  }
  return raw.slice(0, 100)
}

// ---- Favicon 工具 ----

const FAVICON_PALETTE = [
  { bg: '#EF4444', fg: '#fff' },
  { bg: '#F97316', fg: '#fff' },
  { bg: '#F59E0B', fg: '#fff' },
  { bg: '#10B981', fg: '#fff' },
  { bg: '#06B6D4', fg: '#fff' },
  { bg: '#3B82F6', fg: '#fff' },
  { bg: '#6366F1', fg: '#fff' },
  { bg: '#8B5CF6', fg: '#fff' },
  { bg: '#EC4899', fg: '#fff' },
  { bg: '#14B8A6', fg: '#fff' },
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function getDomainFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export function getFaviconColor(key: string): { bg: string; fg: string } {
  return FAVICON_PALETTE[hashString(key) % FAVICON_PALETTE.length]!
}

export function getFaviconLetter(title: string, url?: string): string {
  const source = url ? getDomainFromUrl(url) : title
  return (source.trim().charAt(0).toUpperCase()) || '?'
}
