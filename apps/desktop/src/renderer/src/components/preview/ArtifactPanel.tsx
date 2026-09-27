/**
 * 预览面板（ArtifactPanel）—— 右侧面板「产物预览」标签的内容。
 * 逻辑 / UI 布局对齐 web 端 apps/web/src/components/ArtifactPreview/ArtifactPanel.tsx。
 *
 * 多标签改造要点：
 *  - 标题与关闭入口已上移到标签栏（PanelTabBar），本组件只保留类型标识与产物操作，
 *    避免标签栏与内容区出现两套标题 / 关闭按钮；
 *  - 状态仍取自 activeArtifactAtom（现已派生自激活标签），切换标签即切换内容；
 *  - 复制走原生剪贴板 IPC（clipboardApi.write），失败回退 navigator.clipboard；
 *  - 下载走原生「另存为」对话框（fileApi.saveDialog）再写盘（fileApi.write）。
 */
import { useState, useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { ArrowLeft, Copy, Download, Check, FileCode2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fileApi, clipboardApi } from '@/services/ipc'
import {
  activeArtifactAtom,
  closeArtifactAtom,
  highlightMessageAtom,
  type ActiveArtifact
} from '@/stores/artifactStore'
import type { ArtifactType } from '@shared/types'
import { ArtifactRender } from './ArtifactRender'

/** 产物类型 → 工具条上的类型标识 */
const ARTIFACT_TYPE_LABEL: Record<ArtifactType, string> = {
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Mermaid',
  markdown: 'Markdown',
  code: '代码'
}

/** 下载元信息：另存为的扩展名与过滤器名称（code 为动态分支，不在此表内） */
const ARTIFACT_DOWNLOAD: Record<
  Exclude<ArtifactType, 'code'>,
  { ext: string; filterName: string }
> = {
  html: { ext: 'html', filterName: 'HTML 文件' },
  svg: { ext: 'svg', filterName: 'SVG 文件' },
  mermaid: { ext: 'mmd', filterName: 'Mermaid 源码' },
  markdown: { ext: 'md', filterName: 'Markdown 文件' }
}

/**
 * 解析产物的下载元信息（另存为的扩展名与过滤器）。
 *
 * code 类型为动态分支（扩展名取决于具体语言），单独处理；
 * 其余类型查表 —— Record 的穷举约束会在新增类型时强制补齐，避免遗漏分支。
 * 标题与关闭入口由标签栏承担，此处不再解析 title。
 */
function resolveArtifactDownload(artifact: ActiveArtifact): {
  ext: string
  filters: Array<{ name: string; extensions: string[] }>
} {
  if (artifact.type === 'code') {
    const ext = artifact.language && artifact.language !== 'code' ? artifact.language : 'txt'
    return {
      ext,
      filters: [
        { name: ext === 'txt' ? '文本文件' : `${ext.toUpperCase()} 文件`, extensions: [ext] }
      ]
    }
  }
  const preset = ARTIFACT_DOWNLOAD[artifact.type]
  return {
    ext: preset.ext,
    filters: [{ name: preset.filterName, extensions: [preset.ext] }]
  }
}

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
    const { ext, filters } = resolveArtifactDownload(artifact)

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
    // 随后关闭当前产物标签 —— 在标签模型下这会自动激活相邻标签（通常是任务视图），
    // 效果等同于「跳转后返回上一层」，无需再显式控制面板显隐。
    highlightMessage(artifact.messageId)
    closeArtifact()
  }, [artifact, highlightMessage, closeArtifact])

  if (!artifact) return null

  const typeLabel =
    artifact.type === 'code'
      ? artifact.language || ARTIFACT_TYPE_LABEL.code
      : ARTIFACT_TYPE_LABEL[artifact.type]

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* 工具条：标题与关闭入口已上移到标签栏，此处仅保留类型标识与产物操作 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[12px] text-muted-foreground">{typeLabel}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* 产物预览（messageId 为空）无源消息可跳转，隐藏入口避免点击无响应 */}
          {artifact.messageId && (
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
          )}

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
        </div>
      </div>

      {/* 主体：iframe（html/svg）或 代码视图（code） */}
      <div className="min-h-0 flex-1">
        <ArtifactRender type={artifact.type} content={artifact.content} language={artifact.language} />
      </div>
    </div>
  )
}
