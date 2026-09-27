// ============================================================
// TaskPipelineTab — 「任务流水线」标签内容
// ============================================================
// 由原 ContextPanel 的流水线视图拆出：标题已上移到标签栏，
// 此处保留阶段徽章行与「流式实时 / 历史回放」的数据装配逻辑。
// ============================================================

import { useChatStore } from '@/stores/chatStore'
import type { ToolCall } from '@shared/types'
import { cn } from '@/lib/utils'
import { TaskPipeline } from './TaskPipeline'

/** 任务流水线阶段；衍生自 chatStore 的流式/工具/错误状态 */
type Phase = 'idle' | 'thinking' | 'executing' | 'done' | 'error'

const PHASE_BADGE: Record<Phase, { text: string; className: string }> = {
  idle: { text: '待机', className: 'bg-muted text-muted-foreground' },
  thinking: { text: '思考中', className: 'bg-amber-500/12 text-amber-600' },
  executing: { text: '执行中', className: 'bg-blue-500/12 text-blue-600' },
  done: { text: '已完成', className: 'bg-green-500/12 text-green-600' },
  error: { text: '失败', className: 'bg-red-500/12 text-red-600' }
}

/** 根据流式状态、思考内容、工具调用状态与错误信息推导当前阶段 */
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

export function TaskPipelineTab() {
  // 逐项订阅，避免 streamingContent 高频更新触发面板全量重渲染
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingThinking = useChatStore((s) => s.streamingThinking)
  const streamingToolCalls = useChatStore((s) => s.streamingToolCalls)
  const error = useChatStore((s) => s.error)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const messages = useChatStore((s) => s.messages)

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
    <div className="flex h-full flex-col">
      {/* 阶段徽章行（原面板 header 的徽章迁移至此，标题已由标签栏承担） */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-[12px] text-muted-foreground">任务状态</span>
        <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium', badge.className)}>
          {badge.text}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TaskPipeline
          isStreaming={isStreaming}
          thinking={streamingThinking}
          toolCalls={historyToolCalls}
          error={error}
          phase={phase}
        />
      </div>
    </div>
  )
}
