/**
 * 预览面板（ArtifactPanel）—— 桌面端右侧栏的产物预览面板。
 * 逻辑 / UI 布局对齐 web 端 apps/web/src/components/ArtifactPreview/ArtifactPanel.tsx。
 *
 * 与 web 实现的差异（适配桌面端环境）：
 *  - 状态来自 Jotai（activeArtifactAtom / highlightMessageAtom），与 contextPanelVisibleAtom 联动；
 *  - 复制走原生剪贴板 IPC（clipboardApi.write），失败回退 navigator.clipboard；
 *  - 下载走原生「另存为」对话框（fileApi.saveDialog）再写盘（fileApi.write），
 *    比 web 的 Blob 自动下载更贴近桌面预期；
 *  - UI 采用 Tailwind / shadcn Button + Tooltip，与桌面端其它面板一致。
 */
import { useState, useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { ArrowLeft, Copy, Download, X, Check, FileCode2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { fileApi, clipboardApi } from '@/services/ipc'
import {
  activeArtifactAtom,
  closeArtifactAtom,
  highlightMessageAtom
} from '@/stores/artifactStore'
import { ArtifactRender } from './ArtifactRender'

export function ArtifactPanel() {
  const artifact = useAtomValue(activeArtifactAtom)
  const closeArtifact = useSetAtom(closeArtifactAtom)
  const highlightMessage = useSetAtom(highlightMessageAtom)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!artifact) return
    // 优先走原生剪贴板 IPC；不可用时回退到 Web Clipboard API（与 web 端行为对齐）
    if (clipboardApi.write) {
      clipboardApi.write(artifact.content)
    } else {
      try {
        await navigator.clipboard.writeText(artifact.content)
      } catch {
        /* 静默失败：权限被拒时仅复原按钮，不影响其它功能 */
      }
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [artifact])

  const handleDownload = useCallback(async () => {
    if (!artifact) return
    const ext =
      artifact.type === 'html'
        ? 'html'
        : artifact.type === 'svg'
          ? 'svg'
          : artifact.type === 'mermaid'
            ? 'mmd'
            : artifact.language && artifact.language !== 'code'
              ? artifact.language
              : 'txt'
    const filters =
      artifact.type === 'html'
        ? [{ name: 'HTML 文件', extensions: ['html'] }]
        : artifact.type === 'svg'
          ? [{ name: 'SVG 文件', extensions: ['svg'] }]
          : artifact.type === 'mermaid'
            ? [{ name: 'Mermaid 源码', extensions: ['mmd'] }]
            : [{ name: '文本文件', extensions: ['txt'] }]

    const result = await fileApi.saveDialog({
      title: '保存预览产物',
      defaultPath: `artifact.${ext}`,
      filters
    })
    const paths = result?.filePaths
    if (result?.canceled || !paths?.length) return
    const filePath = paths[0]
    if (!filePath) return
    await fileApi.write({ filePath, content: artifact.content })
  }, [artifact])

  const handleJumpToSource = useCallback(() => {
    if (!artifact) return
    // 写入高亮信号，由消息列表消费（滚动定位 + 高亮对应消息）；
    // 桌面端预览为覆盖层，跳转时一并关闭预览以露出聊天区并定位源消息（适配桌面布局）
    highlightMessage(artifact.messageId)
    closeArtifact()
  }, [artifact, highlightMessage, closeArtifact])

  if (!artifact) return null

  const title =
    artifact.type === 'html'
      ? 'HTML 预览'
      : artifact.type === 'svg'
        ? 'SVG 预览'
        : artifact.type === 'mermaid'
          ? '图表预览 · Mermaid'
          : `代码预览 · ${artifact.language}`

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* 头部：标题 + 操作按钮（复制 / 下载 / 跳转源 / 关闭） */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={handleJumpToSource}
                title="跳转源消息"
                aria-label="跳转源消息"
              >
                <ArrowLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>跳转源消息</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={handleCopy}
                title="复制"
                aria-label={copied ? '已复制' : '复制内容'}
              >
                {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? '已复制' : '复制'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={handleDownload}
                title="下载"
                aria-label="下载产物"
              >
                <Download className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>下载</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={closeArtifact}
                title="关闭"
                aria-label="关闭预览"
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>关闭</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* 主体：iframe（html/svg）或 纯文本（code） */}
      <div className={cn('min-h-0 flex-1')}>
        <ArtifactRender type={artifact.type} content={artifact.content} />
      </div>
    </div>
  )
}
