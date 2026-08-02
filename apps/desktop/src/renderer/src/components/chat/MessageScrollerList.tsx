// ============================================================
// MessageScrollerList — 消息列表（基于 @shadcn/react Message Scroller）
// ============================================================
// 用 shadcn/ui Message Scroller 替换原 ScrollArea + 虚拟化 + isNearBottomRef。
//
// 设计要点：
//   1. **不虚拟化**：依赖 MessageScrollerItem 内置的
//      `[content-visibility:auto] [contain-intrinsic-size:auto_10rem]`
//      让浏览器跳过不可见子树的渲染，对长会话比 JS 测高更轻量。
//   2. **流式自动跟随**：Provider 的 autoScroll 默认开，
//      用户向上滚动后自动停止跟随，避免被流式拉回。
//   3. **新 turn 锚定**：user 消息标记为 scrollAnchor，
//      Provider 会把新 turn 锚定到视口顶部附近（上方保留 80px 上一条消息作为上下文）。
//   4. **跳到最新按钮**：MessageScrollerButton 距底时自动显隐。
//   5. **重开定位**：defaultScrollPosition='end'，拉到底部（与 legacy 一致）。
//   6. **跳转源消息高亮**：消费 highlightMessageIdAtom，scrollIntoView + 短暂描边。
//
// 与原 MessageList 的差异：
//   - 不使用 @tanstack/react-virtual，常规流布局
//   - 不使用 isNearBottomRef，由 Provider 接管
//   - gap-8（32px）替代 pb-4（16px），与官方默认视觉一致
//   - 同发送者分组（T05）通过 groupPosition 控制头像显隐与间距
// ============================================================

import { ChevronDown } from 'lucide-react'
import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { MessageBubble } from './MessageBubble'
import { Button } from '@/components/ui/button'
import {
  MessageScroller,
  MessageScrollerProvider,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton
} from '@/components/ui/message-scroller'
import { highlightMessageIdAtom, clearHighlightAtom } from '@/stores/artifactStore'
import type { Message, ToolCall } from '@shared/types'

/**
 * 复用 legacy MessageList 的分组位置算法（T05）。
 * 同发送者连续消息的视觉聚合：组内非末条隐藏头像、组内间距收紧。
 */
type GroupPosition = 'single' | 'start' | 'middle' | 'end'

function computeGroupPosition(messages: Message[], index: number): GroupPosition {
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

interface MessageScrollerListProps {
  messages: Message[]
  streamingContent?: string
  streamingThinking?: string
  streamingToolCalls?: ToolCall[]
  streamingTraceNodes?: Record<string, import('@shared/types').TraceNode>
  streamingTraceRootOrder?: string[]
  streamingMessageId?: string | null
  isStreaming?: boolean
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
}

export function MessageScrollerList({
  messages,
  streamingContent,
  streamingThinking,
  streamingToolCalls,
  streamingTraceNodes,
  streamingTraceRootOrder,
  streamingMessageId,
  isStreaming,
  hasMore,
  isLoadingMore,
  onLoadMore
}: MessageScrollerListProps) {
  // 跳转源消息：预览面板「跳转到源消息」写入 highlightMessageIdAtom 后，
  // 这里消费该信号——滚动定位到对应消息并做短暂高亮，随后清除信号。
  // 与 legacy MessageList 行为对齐（content-visibility 下元素仍可被 scrollIntoView）。
  const highlightId = useAtomValue(highlightMessageIdAtom)
  const clearHighlight = useSetAtom(clearHighlightAtom)

  useEffect(() => {
    if (!highlightId) return
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-slot="message-scroller-viewport"] [data-message-id="${highlightId}"]`
      )
      if (el) {
        el.classList.add('artifact-source-highlight')
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        window.setTimeout(() => el.classList.remove('artifact-source-highlight'), 2200)
      }
      clearHighlight()
    }, 140)
    return () => window.clearTimeout(t)
  }, [highlightId, clearHighlight])

  return (
    <MessageScrollerProvider
      // autoScroll 让流式输出自动跟随 live edge，
      // 用户向上滚动后 Provider 自动停止跟随（多信号融合：
      // 滚动/文字选中/键盘/链接点击/搜索）。
      autoScroll
      // 重开会话定位策略：拉到底部（与 legacy 一致，安全默认）
      defaultScrollPosition="end"
      // 新 turn 锚定时，上方保留 80px 上一条消息作为上下文
      scrollPreviousItemPeek={80}
      // 距底部 80px 内视为"在边缘"，与 legacy isNearBottomRef 阈值一致
      scrollEdgeThreshold={80}
    >
      <MessageScroller className="h-full">
        <MessageScrollerViewport aria-label="对话消息列表">
          <MessageScrollerContent className="px-3 py-4 gap-4">
            {hasMore && (
              <div className="flex justify-center pb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1 text-muted-foreground hover:text-foreground"
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                >
                  <ChevronDown className="size-3" />
                  {isLoadingMore ? '加载中...' : '加载更多历史消息'}
                </Button>
              </div>
            )}
            {messages.map((msg, index) => {
              const isStreamingMsg = isStreaming && msg.id === streamingMessageId
              const groupPosition = computeGroupPosition(messages, index)
              // user 消息标记为 scrollAnchor，让新 turn 锚定到视口顶部附近
              const isScrollAnchor = msg.role === 'user'
              // T05：组内非末条减小底部间距（4px），组尾或最后一条保持 16px
              const isGroupTail =
                groupPosition === 'end' || groupPosition === 'single'
              const isLast = index === messages.length - 1
              const itemClassName = isLast
                ? ''
                : isGroupTail
                  ? 'pb-4'
                  : 'pb-1'
              return (
                <MessageScrollerItem
                  key={msg.id}
                  messageId={msg.id}
                  data-message-id={msg.id}
                  scrollAnchor={isScrollAnchor}
                  className={itemClassName}
                >
                  <MessageBubble
                    message={msg}
                    isStreaming={isStreamingMsg}
                    streamingContent={isStreamingMsg ? streamingContent : undefined}
                    streamingThinking={isStreamingMsg ? streamingThinking : undefined}
                    streamingToolCalls={isStreamingMsg ? streamingToolCalls : undefined}
                    streamingTraceNodes={isStreamingMsg ? streamingTraceNodes : undefined}
                    streamingTraceRootOrder={isStreamingMsg ? streamingTraceRootOrder : undefined}
                  />
                </MessageScrollerItem>
              )
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>

        {/* 跳到最新按钮，距底时自动显隐（弹性动画） */}
        <MessageScrollerButton direction="end" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
