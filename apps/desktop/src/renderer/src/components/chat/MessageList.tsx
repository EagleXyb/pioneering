import { Bot } from 'lucide-react'
import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageBubble } from './MessageBubble'
import type { Message, ToolCall } from '@shared/types'
import { MESSAGE_LIST_ESTIMATE_HEIGHT, MESSAGE_LIST_OVERSCAN } from '@/lib/constants'
import { highlightMessageIdAtom, clearHighlightAtom } from '@/stores/artifactStore'

/**
 * T05 轻量分组：同发送者连续消息的视觉聚合。
 *
 * 阶段 1 退出标准要求"虚拟化滚动行为不变"，因此不引入 MessageGroup
 * 组件（其 flex 流式布局与虚拟化的 position:absolute 不兼容）。
 * 改为：在虚拟化层之上识别分组，通过 groupPosition prop 传给
 * MessageBubble，由后者控制头像显隐与间距。真正的 MessageGroup
 * 组件留到阶段 2 移除虚拟化后启用。
 *
 * groupPosition 语义：
 *   - 'single'：孤立消息（前后均无同发送者消息）
 *   - 'start' ：同发送者组的第一条
 *   - 'middle'：同发送者组的中间条
 *   - 'end'   ：同发送者组的最后一条
 */
type GroupPosition = 'single' | 'start' | 'middle' | 'end'

function computeGroupPosition(
  messages: Message[],
  index: number
): GroupPosition {
  const cur = messages[index]
  if (!cur) return 'single'
  const prev = index > 0 ? messages[index - 1] : undefined
  const next = index < messages.length - 1 ? messages[index + 1] : undefined
  const samePrev = !!prev && prev.role === cur.role
  const sameNext = !!next && next.role === cur.role
  if (!samePrev && !sameNext) return 'single'
  if (!samePrev && sameNext) return 'start'
  if (samePrev && sameNext) return 'middle'
  return 'end'
}

interface MessageListProps {
  messages: Message[]
  streamingContent?: string
  streamingThinking?: string
  streamingToolCalls?: ToolCall[]
  streamingMessageId?: string | null
  isStreaming?: boolean
  /**
   * 外层 ScrollArea 的根 ref，用于定位视口元素驱动虚拟化滚动。
   * 复用 ConversationList 的视口定位模式：通过 querySelector
   * '[data-radix-scroll-area-viewport]' 获取真实滚动容器。
   * 若未提供则虚拟化降级为无滚动容器（仅渲染首屏估算条数）。
   */
  scrollElementRef?: React.RefObject<HTMLDivElement | null>
}

export function MessageList({
  messages,
  streamingContent,
  streamingThinking,
  streamingToolCalls,
  streamingMessageId,
  isStreaming,
  scrollElementRef
}: MessageListProps) {
  // P1 修复：原实现直接 `.map()` 渲染全部消息，每条跑 ReactMarkdown + rehypeHighlight +
  // rehypeSanitize，长会话下 DOM 膨胀与重渲染开销显著。改为 @tanstack/react-virtual
  // 虚拟化，仅渲染视口内 + overscan 条数。
  // 消息高度差异大，必须用 measureElement 动态测量（配合 ResizeObserver 自动重测），
  // estimateSize 仅作初次占位估算。ChatArea 的自动滚动逻辑（B8 isNearBottomRef）
  // 操作同一视口，二者共存无冲突。
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () =>
      scrollElementRef?.current?.querySelector<HTMLElement>(
        '[data-radix-scroll-area-viewport]'
      ) ?? null,
    estimateSize: () => MESSAGE_LIST_ESTIMATE_HEIGHT,
    overscan: MESSAGE_LIST_OVERSCAN
  })

  // 跳转源消息：预览面板「跳转到源消息」写入 highlightMessageIdAtom 后，
  // 这里消费该信号——滚动定位到对应消息并做短暂高亮，随后清除信号。
  const highlightId = useAtomValue(highlightMessageIdAtom)
  const clearHighlight = useSetAtom(clearHighlightAtom)

  useEffect(() => {
    if (!highlightId) return
    const idx = messages.findIndex((m) => m.id === highlightId)
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'center' })
    }
    // 等虚拟化把目标条渲染进视口后再做 DOM 高亮
    const t = window.setTimeout(() => {
      const viewport = scrollElementRef?.current?.querySelector<HTMLElement>(
        '[data-radix-scroll-area-viewport]'
      )
      const el = viewport?.querySelector<HTMLElement>(`[data-message-id="${highlightId}"]`)
      if (el) {
        el.classList.add('artifact-source-highlight')
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        window.setTimeout(() => el.classList.remove('artifact-source-highlight'), 2200)
      }
      clearHighlight()
    }, 140)
    return () => window.clearTimeout(t)
  }, [highlightId, messages, virtualizer, clearHighlight, scrollElementRef])

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center py-12">
        <div className="text-center text-muted-foreground space-y-2">
          <Bot className="size-16 mx-auto opacity-20" />
          <p className="text-lg">开始新对话</p>
          <p className="text-sm">在下方输入消息，与 AI 助手交流</p>
        </div>
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()
  const lastIndex = messages.length - 1

  return (
    <div className="py-4">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: 'relative',
          width: '100%'
        }}
      >
        {items.map((row) => {
          const msg = messages[row.index]
          if (!msg) return null
          const isStreamingMsg = isStreaming && msg.id === streamingMessageId
          const groupPosition = computeGroupPosition(messages, row.index)
          // item 间距：除最后一条外，每条底部留 16px（等价原 space-y-4）。
          // 用 padding 而非 margin，使 measureElement 测量含间距的高度，totalSize 准确。
          // T05：同发送者组内（start/middle）减小底部间距至 4px，视觉聚合；
          //      组尾（end/single）或最后一条保持 16px。
          const isGroupTail = groupPosition === 'end' || groupPosition === 'single'
          const paddingBottom =
            row.index < lastIndex
              ? isGroupTail
                ? 'pb-4'
                : 'pb-1'
              : ''
          return (
            <div
              key={msg.id}
              data-message-id={msg.id}
              data-index={row.index}
              data-group-position={groupPosition}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`
              }}
              className={paddingBottom}
            >
              <MessageBubble
                message={msg}
                isStreaming={isStreamingMsg}
                streamingContent={isStreamingMsg ? streamingContent : undefined}
                streamingThinking={isStreamingMsg ? streamingThinking : undefined}
                streamingToolCalls={isStreamingMsg ? streamingToolCalls : undefined}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
