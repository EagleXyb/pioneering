// ============================================================
// TaskMonitor — 右栏「任务监控」面板
//
// 严格对照截图样式：
//   - 浅灰背景 #f5f5f5
//   - 分组行高较大（py-4），14px 粗体标题 + ChevronRight
//   - 待办列表：绿色实心圆圈（约 22px）+ 删除线灰色文字
//   - 每个分组（含待办展开后）底部有浅灰色全宽分割线
//   - 最后一个分组（意识更新）无下分割线
//   - 产物右侧：文件夹图标在最右边缘
//   - 修复：「产物」分组不再是占位，会读取当前会话所有 assistant
//     消息的 attachments（来自 SSE ARTIFACT_CREATED 事件）并显示
// ============================================================

import { useCallback, useMemo, useState } from 'react'
import {
  Check,
  ChevronRight,
  Download,
  Eye,
  FileText,
  FolderOpen,
  FolderSymlink,
  Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chatStore'
import type { Attachment } from '@shared/types'
import { fileApi } from '@/services/ipc'
import { detectArtifactPreview, getFileExtension } from '@/lib/artifact-preview'
import { useArtifactPreview } from '@/hooks/useArtifactPreview'

interface TodoItem {
  id: string
  text: string
  completed: boolean
}

interface TaskMonitorProps {
  todoItems?: TodoItem[]
}

// 示例待办数据（真实任务待办后续可由 plan/state_delta 事件注入，这里暂时沿用默认值）
const DEFAULT_TODO_ITEMS: TodoItem[] = [
  { id: '1', text: '搜索今日（2026-08-16）AI Agent 相关新闻', completed: true },
  { id: '2', text: '深入抓取重点文章核实细节按专题整理', completed: true },
  { id: '3', text: '汇总撰写Markdown 文档中文新闻综述', completed: true },
  { id: '4', text: '生成并展示 AI Agent 新闻日报文档', completed: true },
]

interface SectionRowProps {
  title: string
  icon?: React.ReactNode
  children?: React.ReactNode
  defaultExpanded?: boolean
  isLast?: boolean
  badge?: string
}

function SectionRow({ title, icon, children, defaultExpanded = false, isLast = false, badge }: SectionRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className={cn(!isLast && 'border-b border-border/40')}>
      <button
        className="w-full flex items-center justify-between py-4 px-4 text-left hover:bg-black/[0.015] dark:hover:bg-white/[0.015] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-muted-foreground">{title}</span>
          {badge && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
              {badge}
            </span>
          )}
          <ChevronRight
            size={16}
            className={cn(
              'text-muted-foreground/70 transition-transform duration-200 mt-[1px]',
              expanded && 'rotate-90',
            )}
          />
        </div>
        {icon && <span className="text-muted-foreground/50">{icon}</span>}
      </button>
      {expanded && children && (
        <div className="px-4 pb-5">
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * 根据文件扩展名 / mediaType 返回人类可读描述
 */
function formatArtifactMeta(a: Attachment): string {
  const sizeText = typeof a.size === 'number' && a.size > 0
    ? (a.size < 1024 ? `${a.size} B`
       : a.size < 1024 * 1024 ? `${(a.size / 1024).toFixed(1)} KB`
       : `${(a.size / 1024 / 1024).toFixed(2)} MB`)
    : ''
  const parts: string[] = []
  if (a.mediaType) {
    const short = a.mediaType.replace(/^text\//, '').replace(/^application\//, '')
    if (short) parts.push(short.toUpperCase())
  }
  if (sizeText) parts.push(sizeText)
  return parts.join(' · ')
}

function ArtifactItem({ artifact }: { artifact: Attachment }) {
  const meta = formatArtifactMeta(artifact)
  // 预览入口（每个卡片独立持有 loading / error，互不干扰）
  const { preview, loadingPath, error } = useArtifactPreview()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const filePath = artifact.filePath
  const previewTarget = useMemo(
    () => detectArtifactPreview(artifact.name, artifact.mediaType),
    [artifact.name, artifact.mediaType]
  )
  // 可预览 = 类型受支持 且 有本地路径；否则卡片主行为退回「在 Finder 中定位」（原有能力不丢失）
  const previewable = Boolean(filePath) && previewTarget !== null
  const isLoading = loadingPath !== null
  const hint = error ?? saveError

  const handlePreview = useCallback(() => {
    if (!previewable) return
    void preview(artifact)
  }, [previewable, preview, artifact])

  const handleShowInFolder = useCallback(() => {
    if (!filePath) return
    void fileApi.showInFolder(filePath).catch(() => {})
  }, [filePath])

  const handleCardClick = useCallback(() => {
    if (previewable) {
      handlePreview()
      return
    }
    handleShowInFolder()
  }, [previewable, handlePreview, handleShowInFolder])

  const handleSaveAs = useCallback(async () => {
    if (!filePath || !previewable) return
    setSaveError(null)
    setSaving(true)
    try {
      // 产物为本地文件：先读回内容，再经「另存为」写盘（FILE_READ / FILE_WRITE 均走既有安全校验）
      const read = await fileApi.read(filePath)
      if (!read.success || typeof read.content !== 'string') {
        setSaveError('读取文件失败，无法另存为')
        return
      }
      const ext = getFileExtension(artifact.name)
      const result = await fileApi.saveDialog({
        title: '另存为',
        defaultPath: artifact.name,
        filters: ext ? [{ name: `${ext.toUpperCase()} 文件`, extensions: [ext] }] : undefined
      })
      const target = result?.filePaths?.[0]
      if (result?.canceled || !target) return
      const written = await fileApi.write({ filePath: target, content: read.content })
      if (!written.success) setSaveError('写入目标文件失败')
    } catch {
      setSaveError('另存为失败')
    } finally {
      setSaving(false)
    }
  }, [filePath, previewable, artifact.name])

  const interactive = previewable || Boolean(filePath)

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? handleCardClick : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleCardClick()
              }
            }
          : undefined
      }
      title={previewable ? '点击预览文件内容' : filePath ? '点击在 Finder 中定位' : undefined}
      className={cn(
        'w-full flex items-start gap-3 p-3 rounded-lg bg-white/60 dark:bg-white/[0.03] border border-border/50 transition-colors',
        interactive && 'cursor-pointer hover:border-blue-500/40 hover:shadow-sm',
        isLoading && 'opacity-70'
      )}
    >
      <div className="shrink-0 size-9 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
        {isLoading ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-foreground truncate">
          {artifact.name}
        </div>
        {meta && (
          <div className="mt-1 text-[12px] text-muted-foreground/80 truncate">
            {meta}
          </div>
        )}
        {filePath && (
          <div className="mt-1 text-[11px] text-muted-foreground/60 truncate font-mono">
            {filePath}
          </div>
        )}
        {!previewable && filePath && (
          <div className="mt-1 text-[11px] text-muted-foreground/60">
            该类型暂不支持应用内预览
          </div>
        )}
        {hint && (
          <div className="mt-1 text-[11px] text-red-600 leading-relaxed break-words">
            {hint}
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0 -mr-1">
        {previewable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handlePreview()
            }}
            disabled={isLoading}
            className="size-8 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground/70 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-center transition-colors disabled:opacity-50"
            title="预览"
            aria-label="预览"
          >
            <Eye size={16} />
          </button>
        )}
        {previewable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void handleSaveAs()
            }}
            disabled={saving}
            className="size-8 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground/70 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-center transition-colors disabled:opacity-50"
            title="另存为"
            aria-label="另存为"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          </button>
        )}
        {filePath && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleShowInFolder()
            }}
            className="size-8 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground/70 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-center transition-colors"
            title="在 Finder 中显示"
            aria-label="在 Finder 中显示"
          >
            <FolderOpen size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

export function TaskMonitor({ todoItems = DEFAULT_TODO_ITEMS }: TaskMonitorProps) {
  // 从 chatStore 取当前会话历史，收集所有 assistant 消息的 attachments（即 ARTIFACT_CREATED 写入的产物）
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const messages = useChatStore((s) => s.messages)
  const streamingAttachments = useChatStore((s) => s.streamingAttachments)

  const artifacts: Attachment[] = useMemo(() => {
    const collected: Attachment[] = []
    const seenIds = new Set<string>()
    if (currentSessionId) {
      const list = messages[currentSessionId] ?? []
      for (const m of list) {
        if (m.role !== 'assistant') continue
        const atts = (m as any).attachments as Attachment[] | undefined
        if (!atts || atts.length === 0) continue
        for (const a of atts) {
          if (!a || !a.id) continue
          if (seenIds.has(a.id)) continue
          seenIds.add(a.id)
          collected.push(a)
        }
      }
    }
    // 合并流式期间的产物（尚未持久化到消息的 attachment）
    if (Array.isArray(streamingAttachments) && streamingAttachments.length > 0) {
      for (const a of streamingAttachments) {
        if (!a || !a.id) continue
        if (seenIds.has(a.id)) continue
        seenIds.add(a.id)
        collected.push(a)
      }
    }
    return collected
  }, [currentSessionId, messages, streamingAttachments])

  return (
    <div className="flex flex-col h-full bg-[#f5f5f5] dark:bg-[#1a1a1a] overflow-y-auto">
      {/* 待办：默认展开 */}
      <SectionRow title="待办" defaultExpanded>
        <div className="space-y-3">
          {todoItems.map((item) => (
            <div key={item.id} className="text-[13px] leading-[1.6]">
              <span
                className={cn(
                  'inline-flex items-center justify-center w-3.5 h-3.5 rounded-full mr-2 -mt-[1px] align-middle shrink-0',
                  item.completed
                    ? 'bg-[#22c55e] text-white'
                    : 'border-2 border-border bg-background',
                )}
              >
                {item.completed && <Check size={9} strokeWidth={3} />}
              </span>
              <span
                className={cn(
                  item.completed
                    ? 'text-muted-foreground/70 line-through'
                    : 'text-muted-foreground',
                )}
              >
                {item.text}
              </span>
            </div>
          ))}
          {todoItems.length === 0 && (
            <div className="text-[13px] text-muted-foreground/60">暂无待办项</div>
          )}
        </div>
      </SectionRow>

      {/* 产物：读取会话附件（来自 ARTIFACT_CREATED）。无产物时显示空提示；默认展开以利于可见。 */}
      <SectionRow
        title="产物"
        icon={<FolderSymlink size={18} strokeWidth={1.5} />}
        defaultExpanded
        badge={artifacts.length > 0 ? String(artifacts.length) : undefined}
      >
        {artifacts.length > 0 ? (
          <div className="space-y-2">
            {artifacts.map((a) => (
              <ArtifactItem key={a.id} artifact={a} />
            ))}
            <div className="pt-2 text-[11px] text-muted-foreground/60 leading-relaxed">
              提示：点击卡片可预览文件内容（支持 Markdown / HTML / SVG / 代码）；右侧图标可另存为或在 Finder 中定位。
            </div>
          </div>
        ) : (
          <div className="py-3 text-[13px] text-muted-foreground/60 leading-relaxed">
            暂无产物。当任务生成文档/图片/文件时，会显示在这里。
          </div>
        )}
      </SectionRow>

      <SectionRow title="技能与 MCP" />
      <SectionRow title="记忆更新" isLast />
    </div>
  )
}
