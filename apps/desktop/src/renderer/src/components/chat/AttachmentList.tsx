// ============================================================
// AttachmentList — 通用文件附件卡片列表（P3 新增）
// ============================================================
// 渲染 Message.attachments。图片附件仍走既有 message.images 通道
// （MessageBubble 内联缩略图 + Lightbox），本组件仅处理非图片附件。
//
// 打开/下载策略（对齐 H7/H8 既定安全原则）：
//   - http(s) 附件：shellApi.openExternal 交系统浏览器，不在渲染层内嵌；
//   - data: 附件：绝不作为超链接打开（H8：data:text/html 会被新窗口渲染执行，
//     构成钓鱼/HTML 注入面），仅提供「另存为」下载，经 fileApi.saveDialog +
//     fileApi.write 落盘（主进程 H2 调用方校验 + H3 路径白名单）；
//     · 文本类：base64 → UTF-8 解码后写盘（多字节字符无乱码）；
//     · 二进制类：atob 为 latin1 二进制串，主进程按 encoding:'binary' 写盘，
//       字节无损（FILE_WRITE 已实现 encoding 透传）；
//   - 其它协议（javascript:/file:/blob: 等）：渲染为禁用卡片，不可点击。
// ============================================================

import { useState } from 'react'
import {
  File,
  FileText,
  FileCode2,
  FileArchive,
  FileWarning,
  Download,
  Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fileApi, shellApi } from '@/services/ipc'
import type { Attachment } from '@shared/types'

/** 与 SafeLink 一致的外链协议白名单 */
function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** 文本类附件：可安全按 UTF-8 解码下载 */
function isTextual(mediaType: string): boolean {
  return mediaType.startsWith('text/') || /json|xml|javascript|csv|yaml|markdown/.test(mediaType)
}

function attachmentIcon(mediaType: string) {
  if (mediaType.startsWith('text/')) return FileText
  if (/json|javascript|xml|yaml|csv/.test(mediaType)) return FileCode2
  if (/zip|tar|gzip|7z|rar/.test(mediaType)) return FileArchive
  return File
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** base64 → UTF-8 文本（逐字节还原后经 TextDecoder 解码，多字节字符安全） */
function base64ToText(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

interface AttachmentListProps {
  attachments: Attachment[]
  /** 与图片区一致的对齐策略：用户消息靠右 */
  isUser?: boolean
}

export function AttachmentList({ attachments, isUser }: AttachmentListProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  const handleOpen = async (att: Attachment) => {
    // 本地文件路径（Agent 产物）→ 「另存为」下载
    if (att.filePath) {
      const result = await fileApi.saveDialog({
        title: '保存附件',
        defaultPath: att.name || 'attachment'
      })
      const savePath = result?.filePaths?.[0]
      if (result?.canceled || !savePath) return
      setDownloadingId(att.id)
      setFailedId(null)
      try {
        const readResult = await fileApi.read(att.filePath)
        if (readResult.success && readResult.content !== undefined) {
          const writeResult = await fileApi.write({ filePath: savePath, content: readResult.content })
          if (!writeResult.success) setFailedId(att.id)
        } else {
          setFailedId(att.id)
        }
      } catch {
        setFailedId(att.id)
      } finally {
        setDownloadingId(null)
      }
      return
    }
    if (!att.dataUrl) return
    if (isHttpUrl(att.dataUrl)) {
      shellApi.openExternal(att.dataUrl)
      return
    }
    // data: 附件 → 「另存为」下载（不作为链接打开，遵循 H8）
    const result = await fileApi.saveDialog({
      title: '保存附件',
      defaultPath: att.name || 'attachment'
    })
    const filePath = result?.filePaths?.[0]
    if (result?.canceled || !filePath) return
    setDownloadingId(att.id)
    setFailedId(null)
    try {
      const base64 = att.dataUrl.split(',')[1] ?? ''
      const writeResult = isTextual(att.mediaType)
        ? await fileApi.write({ filePath, content: base64ToText(base64) })
        : await fileApi.write({ filePath, content: atob(base64), encoding: 'binary' })
      if (!writeResult.success) setFailedId(att.id)
    } catch {
      setFailedId(att.id)
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className={cn('flex flex-wrap gap-2', isUser && 'justify-end')}>
      {attachments.map((att) => {
        const trusted = !!att.filePath || (!!att.dataUrl && (isHttpUrl(att.dataUrl) || att.dataUrl.startsWith('data:')))
        const Icon = trusted ? attachmentIcon(att.mediaType) : FileWarning
        const downloading = downloadingId === att.id
        const failed = failedId === att.id
        const sizeLabel = formatSize(att.size)
        return (
          <button
            key={att.id}
            type="button"
            disabled={!trusted || downloading}
            onClick={() => void handleOpen(att)}
            title={
              !trusted
                ? '不支持的附件协议，已禁用'
                : att.filePath
                  ? '另存为下载'
                  : isHttpUrl(att.dataUrl!)
                    ? '在系统浏览器中打开'
                    : '另存为下载'
            }
            aria-label={`附件 ${att.name || '未命名'}`}
            className={cn(
              'flex h-[65px] w-full items-center gap-3 rounded-2xl border border-border/60 bg-muted px-3.5 text-left transition-colors',
              trusted ? 'hover:bg-accent/60' : 'cursor-not-allowed opacity-60'
            )}
          >
            {downloading ? (
              <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Icon className="size-5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-foreground">
                {att.name || '未命名附件'}
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {failed ? '保存失败，请重试' : sizeLabel || att.mediaType}
              </span>
            </span>
            {trusted && !downloading && (
              <Download className="size-4 shrink-0 text-muted-foreground/70" />
            )}
          </button>
        )
      })}
    </div>
  )
}
