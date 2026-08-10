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
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  FileWarning,
  ExternalLink,
  Download,
  Loader2,
  CircleAlert
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

/** 附件类型分类（决定左侧彩色块的颜色、图标、小角标扩展名） */
interface AttachmentKind {
  Icon: typeof FileText
  /** 左侧色块的背景色（渐变） */
  bg: string
  /** 左侧色块上的图标颜色 */
  fg: string
  /** 右下角小标签（扩展名或分类），空字符串不显示 */
  chip: string
  /** chip 标签颜色 */
  chipBg: string
  chipFg: string
}

function detectAttachmentKind(name: string | undefined, mediaType: string): AttachmentKind {
  const ext = (name?.split('.').pop() || '').toLowerCase()
  const chipLimit = 4

  // Markdown / 文档
  if (ext === 'md' || ext === 'markdown' || /markdown/.test(mediaType)) {
    return {
      Icon: FileText,
      bg: 'from-[#5EC4FF] to-[#2F8AE9]',
      fg: 'text-white',
      chip: 'MD'.slice(0, chipLimit),
      chipBg: 'bg-white/90',
      chipFg: 'text-[#2F8AE9]'
    }
  }
  if (ext === 'pdf' || mediaType.includes('pdf')) {
    return {
      Icon: FileText,
      bg: 'from-[#FF7A7A] to-[#E04949]',
      fg: 'text-white',
      chip: 'PDF',
      chipBg: 'bg-white/90',
      chipFg: 'text-[#E04949]'
    }
  }
  if (['doc', 'docx', 'rtf', 'pages'].includes(ext) || /msword|wordprocessingml/.test(mediaType)) {
    return {
      Icon: FileText,
      bg: 'from-[#6FA2FF] to-[#3669D6]',
      fg: 'text-white',
      chip: (ext || 'DOC').toUpperCase().slice(0, chipLimit),
      chipBg: 'bg-white/90',
      chipFg: 'text-[#3669D6]'
    }
  }
  // 表格
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext) || /spreadsheet|excel|csv/.test(mediaType)) {
    return {
      Icon: FileSpreadsheet,
      bg: 'from-[#6FD99B] to-[#2DA860]',
      fg: 'text-white',
      chip: (ext || 'XLS').toUpperCase().slice(0, chipLimit),
      chipBg: 'bg-white/90',
      chipFg: 'text-[#2DA860]'
    }
  }
  // 代码
  if (['json', 'js', 'ts', 'tsx', 'jsx', 'py', 'html', 'css', 'yml', 'yaml', 'xml', 'sql', 'sh', 'rs', 'go', 'java', 'c', 'cpp', 'h'].includes(ext)
      || /json|javascript|xml|yaml|code/.test(mediaType)) {
    return {
      Icon: FileCode2,
      bg: 'from-[#C58DFF] to-[#8F57E4]',
      fg: 'text-white',
      chip: (ext || 'CODE').toUpperCase().slice(0, chipLimit),
      chipBg: 'bg-white/90',
      chipFg: 'text-[#8F57E4]'
    }
  }
  // 压缩包
  if (['zip', 'tar', 'gz', '7z', 'rar', 'bz2'].includes(ext) || /zip|rar|7z|tar|compress/.test(mediaType)) {
    return {
      Icon: FileArchive,
      bg: 'from-[#FFD27A] to-[#E6A23C]',
      fg: 'text-white',
      chip: (ext || 'ZIP').toUpperCase().slice(0, chipLimit),
      chipBg: 'bg-white/90',
      chipFg: 'text-[#E6A23C]'
    }
  }
  // 图片
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic'].includes(ext) || mediaType.startsWith('image/')) {
    return {
      Icon: FileImage,
      bg: 'from-[#FF9AD3] to-[#E55FA6]',
      fg: 'text-white',
      chip: (ext || 'IMG').toUpperCase().slice(0, chipLimit),
      chipBg: 'bg-white/90',
      chipFg: 'text-[#E55FA6]'
    }
  }
  // 视频
  if (['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv'].includes(ext) || mediaType.startsWith('video/')) {
    return {
      Icon: FileVideo,
      bg: 'from-[#FF8080] to-[#CF4A4A]',
      fg: 'text-white',
      chip: (ext || 'MP4').toUpperCase().slice(0, chipLimit),
      chipBg: 'bg-white/90',
      chipFg: 'text-[#CF4A4A]'
    }
  }
  // 音频
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext) || mediaType.startsWith('audio/')) {
    return {
      Icon: FileAudio,
      bg: 'from-[#62D0C3] to-[#2A9F96]',
      fg: 'text-white',
      chip: (ext || 'MP3').toUpperCase().slice(0, chipLimit),
      chipBg: 'bg-white/90',
      chipFg: 'text-[#2A9F96]'
    }
  }
  // 文本 / 默认
  if (mediaType.startsWith('text/') || ['txt', 'log', 'mdx'].includes(ext)) {
    return {
      Icon: FileText,
      bg: 'from-[#A9B8D3] to-[#6B7FA3]',
      fg: 'text-white',
      chip: (ext || 'TXT').toUpperCase().slice(0, chipLimit),
      chipBg: 'bg-white/90',
      chipFg: 'text-[#6B7FA3]'
    }
  }
  return {
    Icon: File,
    bg: 'from-[#B6C0CF] to-[#7E8AA0]',
    fg: 'text-white',
    chip: (ext || 'FILE').toUpperCase().slice(0, chipLimit),
    chipBg: 'bg-white/90',
    chipFg: 'text-[#7E8AA0]'
  }
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
    <div className={cn('flex flex-wrap gap-2.5', isUser && 'justify-end')}>
      {attachments.map((att) => {
        const trusted = !!att.filePath || (!!att.dataUrl && (isHttpUrl(att.dataUrl) || att.dataUrl.startsWith('data:')))
        const isExternal = trusted && !!att.dataUrl && isHttpUrl(att.dataUrl!)
        const kind = detectAttachmentKind(att.name, att.mediaType)
        const downloading = downloadingId === att.id
        const failed = failedId === att.id
        const sizeLabel = formatSize(att.size)

        const { Icon, bg, fg, chip, chipBg, chipFg } = trusted ? kind : {
          Icon: FileWarning,
          bg: 'from-[#E5B26A] to-[#C4852E]',
          fg: 'text-white',
          chip: '!',
          chipBg: 'bg-white/90',
          chipFg: 'text-[#C4852E]'
        }

        const ActionIcon = isExternal ? ExternalLink : failed ? CircleAlert : Download

        return (
          <button
            key={att.id}
            type="button"
            disabled={!trusted || downloading}
            onClick={() => void handleOpen(att)}
            title={
              !trusted
                ? '不支持的附件协议，已禁用'
                : isExternal
                  ? '在系统浏览器中打开'
                  : failed
                    ? '保存失败，请重试'
                    : '另存为下载'
            }
            aria-label={`附件 ${att.name || '未命名'}`}
            className={cn(
              'group flex h-[68px] w-full items-center gap-3.5 rounded-2xl bg-muted text-left transition-all duration-150',
              trusted && 'hover:bg-accent/70',
              !trusted && 'cursor-not-allowed opacity-60'
            )}
          >
            {/* 左侧彩色渐变图标块：参照 WorkBuddy 文档卡 */}
            <div className="relative shrink-0 ml-3 my-2 size-[30px] rounded-md overflow-hidden flex items-center justify-center">
              <div className={cn('absolute inset-0 bg-gradient-to-br', bg)} />
              {downloading ? (
                <Loader2 className={cn('relative size-4 animate-spin', fg)} />
              ) : (
                <Icon className={cn('relative size-[14px]', fg)} />
              )}
              {chip && !downloading && (
                <span className={cn(
                  'absolute bottom-0 right-0 rounded-[2px] px-[2px] py-0 text-[7px] font-bold leading-none tracking-tight',
                  chipBg, chipFg
                )}>
                  {chip}
                </span>
              )}
            </div>

            {/* 文件名 + 大小 */}
            <div className="min-w-0 flex-1 pr-1.5">
              <div className="truncate text-[15px] font-medium leading-tight text-foreground/90">
                {att.name || '未命名附件'}
              </div>
              <div className="mt-1 text-[12px] leading-none text-muted-foreground/80">
                {failed
                  ? <span className="text-destructive/80">保存失败，请重试</span>
                  : sizeLabel
                    ? sizeLabel
                    : att.mediaType}
              </div>
            </div>

            {/* 右侧操作图标 */}
            <div className="shrink-0 pr-4">
              {downloading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground/70" />
              ) : trusted ? (
                <ActionIcon className={cn(
                  'size-4 transition-colors',
                  failed ? 'text-destructive/70' : 'text-muted-foreground/60 group-hover:text-foreground/70'
                )} />
              ) : null}
            </div>
          </button>
        )
      })}
    </div>
  )
}
