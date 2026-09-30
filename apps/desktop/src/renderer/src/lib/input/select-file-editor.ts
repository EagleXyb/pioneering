// ============================================================
// select-file-editor — 编辑器文档模型（对应文档 §4）
// EditorDocumentNode 是输入区域的「结构化文档」：文本 / 文件引用 / 插件引用。
// 该模型与序列化文本（含 @{} 标签）互转，是 Token 计算、光标定位、
// 发送与草稿持久化的统一中间表示。
// ============================================================

import {
  createSelectFileToken,
  createSelectPluginTag,
  parseSelectFileText,
  type SelectPluginPayload
} from './select-file-tags'
import { genId } from '@/lib/genId'

// ---- 文档节点 ----
export interface EditorTextNode {
  type: 'text'
  id: string
  text: string
}

export interface EditorFileNode {
  type: 'file'
  id: string
  /** 文件路径（同时作为 fileId） */
  fileId: string
  /** 文件不存在时的回退显示文本 */
  fallbackText: string
}

export interface EditorPluginNode {
  type: 'plugin'
  id: string
  pluginId: string
  label: string
  /** 插件展开后的完整 prompt */
  prompt: string
}

export type EditorDocumentNode = EditorTextNode | EditorFileNode | EditorPluginNode

// ---- 选中文件项 ----
export interface SelectedFileItem {
  id: string
  path: string
  name: string
}

// ---- 节点构造 ----
export function createTextNode(text: string): EditorTextNode {
  return { type: 'text', id: genId(), text }
}

export function createFileNode(fileId: string, fallbackText: string): EditorFileNode {
  return { type: 'file', id: genId(), fileId, fallbackText }
}

export function createPluginNode(pluginId: string, label: string, prompt: string): EditorPluginNode {
  return { type: 'plugin', id: genId(), pluginId, label, prompt }
}

// ---- 序列化（模型 -> 文本）----
interface SerializeOptions {
  /** 插件节点展开为 prompt 明文（发送给 LLM 时使用） */
  expandPluginPrompts?: boolean
  /** 文件引用使用 @{} 内联 Token 而非 <select-file>（编辑器内显示用） */
  inlineTokens?: boolean
}

/**
 * 将文档模型序列化为文本。
 * - 默认：文件用 <select-file>，插件用 <select-plugin>
 * - inlineTokens=true：文件用 @{path}（与编辑器文本、光标偏移一致）
 * - expandPluginPrompts=true：插件节点展开为 prompt 明文
 */
export function serializeEditorDocument(
  document: EditorDocumentNode[],
  options: SerializeOptions = {}
): string {
  const { expandPluginPrompts = false, inlineTokens = false } = options
  return document
    .map((node) => {
      if (node.type === 'text') return node.text
      if (node.type === 'file') {
        return inlineTokens
          ? createSelectFileToken(node.fileId)
          : `<select-file>${node.fileId}</select-file>`
      }
      // plugin
      const payload: SelectPluginPayload = {
        pluginId: node.pluginId,
        label: node.label,
        prompt: node.prompt
      }
      return expandPluginPrompts ? node.prompt : createSelectPluginTag(payload)
    })
    .join('')
}

// ---- 反序列化（文本 -> 模型）----
export interface DeserializedEditorState {
  document: EditorDocumentNode[]
  files: SelectedFileItem[]
}

function basename(path: string): string {
  const cleaned = path.replace(/\\/g, '/')
  const idx = cleaned.lastIndexOf('/')
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned
}

/**
 * 将序列化文本解析为文档模型 + 选中文件列表。
 * 文本中的 @{} / <select-file> 解析为文件节点，<select-plugin> 解析为插件节点。
 */
export function deserializeEditorState(
  text: string,
  _baseFiles: SelectedFileItem[] = []
): DeserializedEditorState {
  const segments = parseSelectFileText(text)
  const document: EditorDocumentNode[] = []
  const files: SelectedFileItem[] = []
  const seenFiles = new Set<string>()

  for (const seg of segments) {
    if (seg.type === 'text') {
      if (seg.content) document.push(createTextNode(seg.content))
    } else if (seg.type === 'file' && seg.filePath) {
      document.push(createFileNode(seg.filePath, seg.filePath))
      if (!seenFiles.has(seg.filePath)) {
        seenFiles.add(seg.filePath)
        files.push({ id: seg.filePath, path: seg.filePath, name: basename(seg.filePath) })
      }
    } else if (seg.type === 'plugin' && seg.plugin) {
      document.push(
        createPluginNode(seg.plugin.pluginId, seg.plugin.label, seg.plugin.prompt)
      )
    }
  }

  return { document, files }
}

/** 构建发送给后端的文本：文件转 <select-file>，插件展开为 prompt。 */
export function buildSendText(
  text: string,
  options: { expandPluginPrompts?: boolean } = {}
): string {
  const { document } = deserializeEditorState(text)
  return serializeEditorDocument(document, {
    expandPluginPrompts: options.expandPluginPrompts ?? true,
    inlineTokens: false
  })
}
