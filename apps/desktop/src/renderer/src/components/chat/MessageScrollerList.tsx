// ============================================================
// MessageScrollerList — T10/T11/T12/T13 新实现
// ============================================================
// 用 shadcn/ui Message Scroller 替换 ScrollArea + 虚拟化 + isNearBottomRef。
//
// 设计要点：
//   1. **不虚拟化**：依赖 MessageScrollerItem 内置的
//      `[content-visibility:auto] [contain-intrinsic-size:auto_10rem]`
//      让浏览器跳过不可见子树的渲染，对长会话比 JS 测高更轻量。
//   2. **流式自动跟随**：Provider 的 autoScroll 默认开，
//      用户向上滚动后自动停止跟随，避免被流式拉回。
//   3. **新 turn 锚定**（T12）：user 消息标记为 scrollAnchor，
//      Provider 会把新 turn 锚定到视口顶部附近。
//   4. **跳到最新按钮**（T13）：MessageScrollerButton 距底时自动显隐。
//   5. **重开定位**（T14）：defaultScrollPosition 由 feature flag 控制。
//
// 与 legacy MessageList 的差异：
//   - 不使用 @tanstack/react-virtual，常规流布局
//   - 不使用 isNearBottomRef，由 Provider 接管
//   - gap-8（32px）替代 pb-4（16px），与官方默认视觉一致
//   - 同发送者分组（T05）通过 groupPosition 控制头像显隐与间距
// ============================================================

import { MessageBubble } from './MessageBubble'
import {
  MessageScroller,
  MessageScrollerProvider,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton
} from '@/components/ui/message-scroller'
import { useFeatureFlag } from '@/lib/feature-flags'
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
  streamingMessageId?: string | null
  isStreaming?: boolean
}

export function MessageScrollerList({
  messages,
  streamingContent,
  streamingThinking,
  streamingToolCalls,
  streamingMessageId,
  isStreaming
}: MessageScrollerListProps) {
  // T14：last-anchor 定位策略由 flag 控制，默认关（保持原"拉到底部"行为）
  const useLastAnchor = useFeatureFlag('scrollLastAnchor')
  // T12：新 turn 锚定由 flag 控制，默认开
  const anchorTurns = useFeatureFlag('scrollAnchorTurns')
  // T13：跳到最新按钮由 flag 控制，默认开
  const showJumpButton = useFeatureFlag('scrollJumpButton')

  // T14：defaultScrollPosition
  //   - end：拉到底部（与 legacy 一致，安全默认）
  //   - last-anchor：定位到最后一条 user 消息（官方推荐，更符合阅读习惯）
  const defaultScrollPosition = useLastAnchor ? 'last-anchor' : 'end'

  return (
    <MessageScrollerProvider
      // T10：autoScroll 让流式输出自动跟随 live edge，
      // 用户向上滚动后 Provider 自动停止跟随（多信号融合：
      // 滚动/文字选中/键盘/链接点击/搜索）。
      autoScroll
      // T14：重开会话定位策略
      defaultScrollPosition={defaultScrollPosition}
      // T12：新 turn 锚定时，上方保留 80px 上一条消息作为上下文
      scrollPreviousItemPeek={anchorTurns ? 80 : 0}
      // 距底部 80px 内视为"在边缘"，与 legacy isNearBottomRef 阈值一致
      scrollEdgeThreshold={80}
    >
      <MessageScroller className="h-full">
        <MessageScrollerViewport aria-label="对话消息列表">
          <MessageScrollerContent className="px-3 py-4 gap-4">
            {messages.map((msg, index) => {
              const isStreamingMsg = isStreaming && msg.id === streamingMessageId
              const groupPosition = computeGroupPosition(messages, index)
              // T12：user 消息标记为 scrollAnchor，让新 turn 锚定到视口顶部附近
              const isScrollAnchor = anchorTurns && msg.role === 'user'
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
                  scrollAnchor={isScrollAnchor}
                  className={itemClassName}
                >
                  <MessageBubble
                    message={msg}
                    isStreaming={isStreamingMsg}
                    streamingContent={isStreamingMsg ? streamingContent : undefined}
                    streamingThinking={isStreamingMsg ? streamingThinking : undefined}
                    streamingToolCalls={isStreamingMsg ? streamingToolCalls : undefined}
                  />
                </MessageScrollerItem>
              )
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>

        {/* T13：跳到最新按钮，距底时自动显隐（弹性动画） */}
        {showJumpButton && <MessageScrollerButton direction="end" />}
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
