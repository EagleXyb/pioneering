// ============================================================
// ContextPanel — 右栏面板（支持任务监控/任务流水线双视图切换）
//
// 字体标准与中间栏 ChatHeader 保持一致：
//   - 标题：16px semibold
//   - 状态徽章：11px
//   - 图标按钮：32px (h-8 w-8)，图标 16px
// ============================================================

import { useState } from 'react'
import { PanelRight, List, Kanban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from '@/components/ui/tooltip'
import { useAtom } from 'jotai'
import { contextPanelVisibleAtom } from '@/stores/atoms'
import { useChatStore } from '@/stores/chatStore'
import type { ToolCall } from '@shared/types'
import { TaskPipeline } from './TaskPipeline'
import { TaskMonitor } from './TaskMonitor'
import { ArtifactPanel } from '@/components/preview/ArtifactPanel'
import { useAtomValue } from 'jotai'
import { activeArtifactAtom } from '@/stores/artifactStore'
import { cn } from '@/lib/utils'

type PanelView = 'monitor' | 'pipeline'

/** 任务流水线阶段；衍生自 chatStore 的流式/工具/错误状态 */
type Phase = 'idle' | 'thinking' | 'executing' | 'done' | 'error'

const PHASE_BADGE: Record<Phase, { text: string; className: string }> = {
  idle: { text: '待机', className: 'bg-muted text-muted-foreground' },
  thinking: { text: '思考中', className: 'bg-amber-500/12 text-amber-600' },
  executing: { text: '执行中', className: 'bg-blue-500/12 text-blue-600' },
  done: { text: '已完成', className: 'bg-green-500/12 text-green-600' },
  error: { text: '失败', className: 'bg-red-500/12 text-red-600' }
}

const VIEW_TITLES: Record<PanelView, string> = {
  monitor: '任务监控',
  pipeline: '任务流水线'
}

/**
 * 根据流式状态、思考内容、工具调用状态与错误信息推导当前阶段。
 */
function derivePhase(
  isStreaming: boolean,
  thinking: string,
  toolCalls: ToolCall[] | undefined,
  error: string | null
): Phase {
  if (error) return 'error'
  if (toolCalls && toolCalls.some((t) => t.status === 'error')) return 'error'
  if (isStreaming) {
    if (toolCalls && toolCalls.some((t) => t.status === 'running')) return 'executing'
    if (thinking) return 'thinking'
    return 'executing'
  }
  if (toolCalls && toolCalls.length > 0) return 'done'
  return 'idle'
}

export function ContextPanel() {
  const [view, setView] = useState<PanelView>('pipeline')
  const setContextPanelVisible = useAtom(contextPanelVisibleAtom)[1]

  // 逐项订阅，避免 streamingContent 高频更新触发面板全量重渲染
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingThinking = useChatStore((s) => s.streamingThinking)
  const streamingToolCalls = useChatStore((s) => s.streamingToolCalls)
  const error = useChatStore((s) => s.error)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const messages = useChatStore((s) => s.messages)
  const activeArtifact = useAtomValue(activeArtifactAtom)

  // 历史工具调用：流式期间用 streamingToolCalls，非流式时取当前会话最后一条
  // assistant 消息的 toolCalls 作为「最近一次任务」回放数据源。
  const historyToolCalls: ToolCall[] | undefined = (() => {
    if (isStreaming) return streamingToolCalls
    if (!currentSessionId) return undefined
    const list = messages[currentSessionId]
    if (!list || list.length === 0) return undefined
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]!
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return m.toolCalls
      }
    }
    return undefined
  })()

  const phase = derivePhase(isStreaming, streamingThinking, historyToolCalls, error)
  const badge = PHASE_BADGE[phase]

  return (
    <div className="relative h-full w-full flex flex-col bg-background">
      {/* Header：标题 + 阶段徽章（仅流水线视图）+ 视图切换 + 收起按钮
         高度与中栏 ChatHeader 保持一致：h-[var(--titlebar-h)] = 48px */}
      <div
        className={cn(
          'flex items-center justify-between h-[var(--titlebar-h)] px-4 border-b border-border shrink-0',
          view === 'monitor' && 'bg-[#f5f5f5] dark:bg-[#1a1a1a]'
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-[14px] font-semibold text-foreground truncate">{VIEW_TITLES[view]}</h3>
          {view === 'pipeline' && (
            <span
              className={cn(
                'text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0',
                badge.className
              )}
            >
              {badge.text}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <TooltipProvider delayDuration={200}>
            {/* 视图切换按钮组 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-8 w-8 rounded-md transition-colors',
                    view === 'monitor'
                      ? 'bg-black/5 dark:bg-white/10 text-foreground'
                      : 'text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10'
                  )}
                  onClick={() => setView('monitor')}
                  aria-label="任务监控视图"
                >
                  <List className="size-[16px]" strokeWidth={1.5} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="text-xs">
                任务监控
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-8 w-8 rounded-md transition-colors',
                    view === 'pipeline'
                      ? 'bg-black/5 dark:bg-white/10 text-foreground'
                      : 'text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10'
                  )}
                  onClick={() => setView('pipeline')}
                  aria-label="任务流水线视图"
                >
                  <Kanban className="size-[16px]" strokeWidth={1.5} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="text-xs">
                任务流水线
              </TooltipContent>
            </Tooltip>

            {/* 收起按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 rounded-md ml-0.5"
                  onClick={() => setContextPanelVisible(false)}
                  aria-label="收起右侧面板"
                >
                  <PanelRight className="size-[16px]" strokeWidth={1.5} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="text-xs">
                收起右侧面板
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Body：根据当前视图渲染对应面板 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === 'monitor' ? (
          <TaskMonitor />
        ) : (
          <TaskPipeline
            isStreaming={isStreaming}
            thinking={streamingThinking}
            toolCalls={historyToolCalls}
            error={error}
            phase={phase}
          />
        )}
      </div>

      {/* 预览面板：存在活跃产物时作为覆盖层铺满右侧栏 */}
      {activeArtifact && (
        <div className="absolute inset-0 z-20 bg-background">
          <ArtifactPanel />
        </div>
      )}
    </div>
  )
}
