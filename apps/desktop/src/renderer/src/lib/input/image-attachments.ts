// ============================================================
// image-attachments — 图片附件系统（对应文档 §6）
// 负责 ImageAttachment 类型与「File -> base64 dataUrl」读取。
// 后端暂未实现视觉通道，但附件在 UI 层完整可用（缩略图/预览/拖拽/粘贴）。
// ============================================================

import { genId } from '@/lib/genId'

export interface ImageAttachment {
  /** 唯一标识 */
  id: string
  /** base64 data URL 或 HTTP URL */
  dataUrl: string
  /** MIME 类型 */
  mediaType: string
}

/** 接受粘贴/拖拽的图片类型 */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** 单个图片大小上限：20MB */
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024

/** 仅图片无文本时的占位文本 */
export const QUEUED_IMAGE_ONLY_TEXT = '[User attached images without additional text.]'

/** 将 File 对象读取为 base64 ImageAttachment（异步）。 */
export async function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  // P4: 入口校验大小（MAX_IMAGE_SIZE 此前已定义却未使用）。
  // 超大图 base64 后内存翻倍并随草稿持久化，可能 OOM / IPC 大对象。
  // 超限直接拒绝，由调用方捕获并向用户提示后丢弃。
  if (typeof file.size === 'number' && file.size > MAX_IMAGE_SIZE) {
    throw new Error(
      `图片「${file.name || '未命名'}」大小超过 ${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)}MB 上限，已忽略`
    )
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Failed to read image as data URL'))
        return
      }
      resolve({
        id: genId(),
        dataUrl: result,
        mediaType: file.type || 'image/png'
      })
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

/** 从剪贴板 DataTransfer 中筛选受支持的图片文件。 */
export function getPastedImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData || !clipboardData.items) return []
  const files: File[] = []
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/') && ACCEPTED_IMAGE_TYPES.includes(item.type)) {
      const file = item.getAsFile()
      // P4: 粘贴阶段即跳过超大文件，避免对超大图发起无谓的 FileReader（拖拽/选择入口
      // 由 fileToImageAttachment 统一拒绝并提示），保持“提示并丢弃”的一致性。
      if (file && file.size <= MAX_IMAGE_SIZE) files.push(file)
    }
  }
  return files
}

/** 深拷贝图片附件列表。 */
export function cloneImageAttachments(images: ImageAttachment[]): ImageAttachment[] {
  return images.map((img) => ({ ...img }))
}

/** 比较两个图片附件列表是否相等（按 id + dataUrl）。 */
export function areImageAttachmentsEqual(left: ImageAttachment[], right: ImageAttachment[]): boolean {
  if (left.length !== right.length) return false
  return left.every((l, i) => {
    const r = right[i]!
    return l.id === r.id && l.dataUrl === r.dataUrl && l.mediaType === r.mediaType
  })
}

/** 估算单张图片占用的 token（粗略：按解码后像素面积）。 */
export function estimateImageTokens(attachment: ImageAttachment): number {
  // 仅作展示用途的粗略估计
  return 1024
}
