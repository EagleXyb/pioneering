import { Bot } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageBubble } from './MessageBubble'
import type { Message, ToolCall } from '@shared/types'
import { MESSAGE_LIST_ESTIMATE_HEIGHT, MESSAGE_LIST_OVERSCAN } from '@/lib/constants'

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
          // item 间距：除最后一条外，每条底部留 16px（等价原 space-y-4）。
          // 用 padding 而非 margin，使 measureElement 测量含间距的高度，totalSize 准确。
          return (
            <div
              key={msg.id}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`
              }}
              className={row.index < lastIndex ? 'pb-4' : ''}
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
