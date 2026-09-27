// ============================================================
// artifact-preview — 产物预览的类型判定（纯函数层）
// ============================================================
// 从 useArtifactPreview 中抽出的纯逻辑，便于单测与跨组件复用：
//   - getFileExtension      取小写扩展名
//   - detectArtifactPreview 判定附件应以何种方式在预览面板渲染
//   - toHumanError          主进程英文错误 → 用户可读中文提示
//
// 约束：本模块无副作用、不访问 window / DOM，可在 node 环境直接测试
// （与 lib/ 下 extractCodeBlocks、select-list、match-accelerator 同构）。
// ============================================================

import type { ArtifactType } from '@shared/types'

/** 可由预览面板渲染的目标类型 */
export interface ArtifactPreviewTarget {
  type: ArtifactType
  /** 代码视图的语言标识（markdown / html 等非代码类型仅作占位） */
  language: string
}

/** 扩展名 → 预览类型；未命中时回退代码视图（未识别语言自动降级纯文本，无副作用） */
const EXT_TO_ARTIFACT: Record<string, ArtifactType> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  svg: 'svg',
  mmd: 'mermaid',
  mermaid: 'mermaid'
}

/** MIME → 预览类型；优先于扩展名，兼容无扩展名的产物 */
const MEDIATYPE_TO_ARTIFACT: Record<string, ArtifactType> = {
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'image/svg+xml': 'svg'
}

/** 明确的二进制类型前缀：utf-8 文本通道读取会损坏，一律拒绝应用内预览 */
const BINARY_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'font/']

/** 明确的二进制 MIME（非前缀匹配）：压缩包与办公文档格式等 */
const BINARY_MIMES = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])

/** SVG 是唯一可按文本安全读取的 image/* 类型 */
const SVG_MIME = 'image/svg+xml'

/** 该 MIME 是否为二进制（不可用 utf-8 通道读取） */
function isBinaryMime(mt: string): boolean {
  if (!mt) return false
  if (mt === SVG_MIME) return false
  if (BINARY_MIME_PREFIXES.some((prefix) => mt.startsWith(prefix))) return true
  return BINARY_MIMES.has(mt)
}

/** 主进程返回的英文错误 → 面向用户的中文提示 */
const HUMAN_ERROR: Record<string, string> = {
  'File exceeds maximum allowed size': '文件超过 10MB 上限，无法在应用内预览',
  'Content exceeds maximum allowed size': '内容超过 10MB 上限',
  'Invalid or disallowed file path': '该文件路径不在允许访问范围内',
  'Forbidden: untrusted sender': '调用来源不可信，已拒绝该请求',
  'IPC not available': '本地文件服务不可用'
}

/** 取小写扩展名（不含点）；无扩展名或隐藏文件返回空串 */
export function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

/**
 * 判定附件在预览面板中的渲染方式。
 *
 * 返回 null 表示不支持应用内预览（图片、二进制等）：
 * 这类文件需要 base64 二进制通道，当前 FILE_READ 为 utf-8 文本通道，
 * 读取会损坏内容，故明确拒绝而非静默渲染乱码，由调用方引导用户
 * 改用「在 Finder 中显示」。
 */
export function detectArtifactPreview(
  name: string,
  mediaType?: string
): ArtifactPreviewTarget | null {
  const ext = getFileExtension(name)
  const mt = (mediaType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

  // 二进制类型（图片 / 音视频 / 压缩包 / 办公文档等）无法经 utf-8 通道安全读取；
  // SVG 例外 —— 其本质是文本，可走沙箱 iframe 渲染
  if (isBinaryMime(mt)) return null

  const byMedia = MEDIATYPE_TO_ARTIFACT[mt]
  if (byMedia) return { type: byMedia, language: ext || byMedia }

  const byExt = EXT_TO_ARTIFACT[ext]
  if (byExt) return { type: byExt, language: ext || byExt }

  return { type: 'code', language: ext || 'code' }
}

/** 把主进程 / Service 层的错误文案转为用户可读提示 */
export function toHumanError(error: string | undefined, name: string): string {
  if (error && HUMAN_ERROR[error]) return HUMAN_ERROR[error]!
  if (error) return error
  return `读取「${name}」失败`
}
