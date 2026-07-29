// ============================================================
// ChatArea — 中栏对话区（消息流 + 输入框）
// ============================================================
//
// T10/T11/T12/T13/T14：通过 feature flag messageScroller 切换
//   - 关（默认）：使用 legacy ScrollArea + MessageList（虚拟化 + isNearBottomRef）
//   - 开：使用 MessageScrollerList（@shadcn/react + content-visibility）
//
// 安全保障：
//   1. legacy 路径完全保留，未做任何修改，flag 关闭时行为与改造前一致
//   2. 新路径独立组件，flag 开启时才挂载
//   3. 两条路径共用同一份 store 数据与 InputArea，无数据层改动
// ============================================================

import { useRef, useEffect, useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from './MessageList'
import { MessageScrollerList } from './MessageScrollerList'
import { InputArea, type InputAreaSendOptions } from './input/InputArea'
import { AgentStatus } from './AgentStatus'
// P1：图片放大预览（Portal 全局单例，关闭时渲染 null，不影响布局）
import { ImageLightbox } from './ImageLightbox'
import { useChatStore } from '../../stores/chatStore'
import { useFeatureFlag } from '@/lib/feature-flags'
import type { Message } from '@shared/types'
import type { ImageAttachment } from '@/lib/input/image-attachments'
// T09：dev-only 压测 mock 数据（仅 DEV 环境打包）
import { generateStressMessages, STRESS_SESSION_PREFIX } from '@/lib/dev/stress-messages'

export function ChatArea() {
  // 逐项选择器订阅，避免全量重渲染（流式期间仅 streaming* 触发重渲染）
  const sessionsLength = useChatStore((s) => s.sessions.length)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const messages = useChatStore((s) => s.messages)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const streamingThinking = useChatStore((s) => s.streamingThinking)
  const streamingToolCalls = useChatStore((s) => s.streamingToolCalls)
  const streamingTraceNodes = useChatStore((s) => s.streamingTraceNodes)
  const streamingTraceRootOrder = useChatStore((s) => s.streamingTraceRootOrder)
  const streamingMessageId = useChatStore((s) => s.streamingMessageId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const agentMode = useChatStore((s) => s.agentMode)
  const setAgentMode = useChatStore((s) => s.setAgentMode)
  const error = useChatStore((s) => s.error)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stopStreaming = useChatStore((s) => s.stopStreaming)
  const clearError = useChatStore((s) => s.clearError)
  const loadSessions = useChatStore((s) => s.loadSessions)
  const loadMoreMessages = useChatStore((s) => s.loadMoreMessages)
  const messagesHasMore = useChatStore((s) => s.messagesHasMore)
  const messagesLoading = useChatStore((s) => s.messagesLoading)

  // T10/T11/T12/T13/T14：feature flag 控制 Message Scroller 启用
  const useMessageScroller = useFeatureFlag('messageScroller')
  // T09：dev-only 压测开关
  const devStress = useFeatureFlag('devStressMessages')
  const devStressCount = useFeatureFlag('devStressCount')

  const scrollRef = useRef<HTMLDivElement>(null)
  // B8: 记录用户是否在底部附近，用于判断流式输出时是否自动滚动。
  // 仅当用户在底部附近才自动滚动，避免用户向上回看历史时被强制拉回底部。
  const isNearBottomRef = useRef(true)

  const realMessages: Message[] = currentSessionId ? messages[currentSessionId] || [] : []
  const hasMore = currentSessionId ? !!messagesHasMore[currentSessionId] : false
  const isLoadingMore = messagesLoading && realMessages.length > 0

  // T09：dev 压测时注入大量 mock 消息（仅 dev，且用 __stress__ 前缀隔离）
  const currentMessages: Message[] = useMemo(() => {
    if (import.meta.env.DEV && devStress && currentSessionId) {
      const stressSessionId = STRESS_SESSION_PREFIX + currentSessionId
      return generateStressMessages(devStressCount, stressSessionId)
    }
    return realMessages
  }, [realMessages, devStress, devStressCount, currentSessionId])

  useEffect(() => {
    if (sessionsLength === 0) {
      loadSessions()
    }
  }, [sessionsLength, loadSessions])

  // B8: 监听滚动位置，更新 isNearBottomRef
  // 仅 legacy 路径需要，新路径由 MessageScrollerProvider 接管
  useEffect(() => {
    if (useMessageScroller) return
    const root = scrollRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
    const target = viewport ?? root
    const handleScroll = () => {
      const threshold = 80 // 距底部 80px 内视为"在底部附近"
      isNearBottomRef.current =
        target.scrollHeight - target.scrollTop - target.clientHeight < threshold
    }
    target.addEventListener('scroll', handleScroll, { passive: true })
    return () => target.removeEventListener('scroll', handleScroll)
  }, [useMessageScroller])

  useEffect(() => {
    if (useMessageScroller) return
    const root = scrollRef.current
    if (!root) return
    // ScrollArea 的滚动发生在内部 Viewport（Root 自身 overflow-hidden），
    // 必须定位 Viewport 元素再设置 scrollTop，否则流式输出期间消息不会跟随到底部。
    const viewport = root.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
    const target = viewport ?? root
    // B8: 仅当用户在底部附近时才自动滚动，避免破坏向上回看历史的体验
    if (isNearBottomRef.current) {
      target.scrollTop = target.scrollHeight
    }
  }, [currentMessages, streamingContent, streamingThinking, streamingToolCalls, isStreaming, useMessageScroller])

  const handleSend = (
    content: string,
    images?: ImageAttachment[],
    options?: InputAreaSendOptions
  ) => {
    void sendMessage(content, {
      images: images ?? [],
      selectedFiles: options?.selectedFiles,
      skill: options?.skill,
      model: options?.model
    })
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Agent Status（实时推理/工具轨迹） */}
      <AgentStatus
        isStreaming={isStreaming}
        thinking={streamingThinking}
        toolCalls={streamingToolCalls}
        error={error}
        onClearError={clearError}
      />

      {/* Messages：与输入框同宽（max-w-[880px]）并居中 */}
      <div className="chat-messages-pane flex-1 overflow-hidden">
        <div className="mx-auto h-full w-full max-w-[880px] px-0">
          {useMessageScroller ? (
            // T10/T11/T12/T13/T14：新路径 — Message Scroller + content-visibility
            <MessageScrollerList
              messages={currentMessages}
              streamingContent={streamingContent}
              streamingThinking={streamingThinking}
              streamingToolCalls={streamingToolCalls}
              streamingTraceNodes={streamingTraceNodes}
              streamingTraceRootOrder={streamingTraceRootOrder}
              streamingMessageId={streamingMessageId}
              isStreaming={isStreaming}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMoreMessages}
            />
          ) : (
            // legacy 路径 — ScrollArea + 虚拟化 + isNearBottomRef
            // 完全保留改造前实现，flag 关闭时行为一致
            <ScrollArea className="h-full" ref={scrollRef}>
              <div className="min-h-full">
                <MessageList
                  messages={currentMessages}
                  streamingContent={streamingContent}
                  streamingThinking={streamingThinking}
                  streamingToolCalls={streamingToolCalls}
                  streamingTraceNodes={streamingTraceNodes}
                  streamingTraceRootOrder={streamingTraceRootOrder}
                  streamingMessageId={streamingMessageId}
                  isStreaming={isStreaming}
                  hasMore={hasMore}
                  isLoadingMore={isLoadingMore}
                  onLoadMore={loadMoreMessages}
                  scrollElementRef={scrollRef}
                />
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* Input */}
      <InputArea
        sessionId={currentSessionId}
        onSend={handleSend}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        disabled={false}
        agentMode={agentMode}
        onToggleAgent={() => setAgentMode(!agentMode)}
      />

      {/* P1：图片放大预览 Lightbox（Portal 挂载，关闭时不渲染任何 DOM） */}
      <ImageLightbox />
    </div>
  )
}
