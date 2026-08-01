// ============================================================
// ContextPanel — 右栏「任务流水线」面板
//
// 改造说明（参考 web 端任务模式右侧面板业务逻辑）：
//   - 移除原 mock 的 Code / Diff / Terminal 三块 Tab（与「工作协作向 AI Agent」
//     定位不符，详见 codewiki/优化迭代方案.md §2.5 L1）
//   - 改为统一的「任务流水线」面板：header（标题 + 阶段徽章 + 收起按钮）
//     + body（TaskPipeline 时间轴，复用 chatStore 的 streamingToolCalls /
//     最后一条 assistant 消息的 toolCalls 作为数据源）
//   - 阶段徽章联动 chatStore 的 isStreaming / streamingThinking / error 与
//     工具调用状态，颜色与文案对齐 web 端 task-pipeline-badge--* 系列
//   - 收起按钮保持原有 contextPanelVisibleAtom 行为，三栏模式由
//     ResizablePanel.collapse() 接管，覆盖模式由 Drawer onClose 接管
// ============================================================

import { PanelRightClose } from 'lucide-react'
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
import { ArtifactPanel } from '@/components/preview/ArtifactPanel'
import { useAtomValue } from 'jotai'
import { activeArtifactAtom } from '@/stores/artifactStore'
import { cn } from '@/lib/utils'

/** 任务流水线阶段；衍生自 chatStore 的流式/工具/错误状态 */
type Phase = 'idle' | 'thinking' | 'executing' | 'done' | 'error'

const PHASE_BADGE: Record<Phase, { text: string; className: string }> = {
  idle: { text: '待机', className: 'bg-muted text-muted-foreground' },
  thinking: { text: '思考中', className: 'bg-amber-500/12 text-amber-600' },
  executing: { text: '执行中', className: 'bg-blue-500/12 text-blue-600' },
  done: { text: '已完成', className: 'bg-green-500/12 text-green-600' },
  error: { text: '失败', className: 'bg-red-500/12 text-red-600' }
}

/**
 * 根据流式状态、思考内容、工具调用状态与错误信息推导当前阶段。
 *
 * 优先级：error > executing > thinking > done > idle
 *   - error：chatStore.error 非空，或任一工具状态为 error
 *   - executing：isStreaming 且存在 running 工具
 *   - thinking：isStreaming 且有思考内容、无 running 工具
 *   - done：非流式且历史工具全部 completed
 *   - idle：无任何工具调用且非流式
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
    return 'executing' // 流式中无明确信号时统一显示为「执行中」
  }
  if (toolCalls && toolCalls.length > 0) return 'done'
  return 'idle'
}

export function ContextPanel() {
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
    <div className="relative h-full w-full">
      <div className="flex flex-col h-full">
      {/* Header：标题 + 阶段徽章 + 收起按钮（高度与窗口标题栏/ChatHeader 一致，同级别并列） */}
      <div
        className="flex items-center justify-between h-[var(--titlebar-h)] px-4 border-b border-border shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-[15px] font-semibold text-foreground truncate">任务流水线</h3>
          <span
            className={cn(
              'text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0',
              badge.className
            )}
          >
            {badge.text}
          </span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 rounded-md"
                onClick={() => setContextPanelVisible(false)}
                aria-label="收起右侧面板"
              >
                <PanelRightClose className="size-[18px]" strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="text-xs">
              收起右侧面板
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Body：时间轴主体（工具调用流水线） */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <TaskPipeline
          isStreaming={isStreaming}
          thinking={streamingThinking}
          toolCalls={historyToolCalls}
          error={error}
          phase={phase}
        />
      </div>

      {/* 预览面板：存在活跃产物时作为覆盖层铺满右侧栏（与 web 端「右栏=预览」一致） */}
      {activeArtifact && (
        <div className="absolute inset-0 z-20 bg-background">
          <ArtifactPanel />
        </div>
      )}
      </div>
    </div>
  )
}
