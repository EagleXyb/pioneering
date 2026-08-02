// ============================================================
// ChatArea — 中栏对话区（消息流 + 输入框）
// ============================================================
//
// 收敛说明（原 T10/T11/T12/T13/T14 feature flag 已移除）：
//   - 消息列表统一使用 MessageScrollerList（@shadcn/react + content-visibility）
//   - legacy ScrollArea + MessageList（虚拟化 + isNearBottomRef）已删除
//   - 流式自动跟随由 MessageScrollerProvider.autoScroll 接管
//   - 滚动感知顶部栏的逻辑保留，统一查询 message-scroller-viewport
// ============================================================

import { useRef, useEffect, useMemo, useCallback, createElement } from 'react'
import { useSetAtom } from 'jotai'
import { chatScrolledAtom } from '@/stores/atoms'
import { MessageScrollerList } from './MessageScrollerList'
import { WelcomeScreen } from './WelcomeScreen'
import { InputArea, type InputAreaSendOptions } from './input/InputArea'
import { AgentStatus } from './ChatStatus'
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

  // T09：dev-only 压测开关
  const devStress = useFeatureFlag('devStressMessages')
  const devStressCount = useFeatureFlag('devStressCount')

  // 消息区容器 ref：用于定位滚动容器，驱动顶部栏下边框显隐
  const messagesPaneRef = useRef<HTMLDivElement>(null)

  // 滚动感知顶部栏：消息区滚动离开顶部（scrollTop > 0）时，
  // ChatHeader 显示下边框；回到顶部/无滚动容器（欢迎页、内容不足一屏）时隐藏。
  const setChatScrolled = useSetAtom(chatScrolledAtom)

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

  // WelcomeScreen 快捷提示词点击：直接发送
  const handleQuickPrompt = useCallback(
    (text: string) => {
      void sendMessage(text, { images: [] })
    },
    [sendMessage]
  )

  // 是否显示欢迎引导页（无消息且非流式状态）
  const showWelcome = currentMessages.length === 0 && !isStreaming && !streamingContent

  // 滚动感知顶部栏：消息区滚动离开顶部（scrollTop > 0）时，
  // ChatHeader 显示下边框；回到顶部/无滚动容器（欢迎页、内容不足一屏）时隐藏。
  useEffect(() => {
    const pane = messagesPaneRef.current
    if (!pane) return
    const container = pane.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"]'
    )
    if (!container) {
      setChatScrolled(false)
      return
    }
    const update = () => setChatScrolled(container.scrollTop > 0)
    update()
    container.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      container.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [showWelcome, currentSessionId, currentMessages.length, setChatScrolled])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages：与输入框同宽（由 --chat-col-max 令牌统一约束，既定 880px）并居中 */}
      <div className="chat-messages-pane flex-1 overflow-hidden" ref={messagesPaneRef}>
        <div className="mx-auto h-full w-full max-w-[var(--chat-col-max)] px-0">
          {showWelcome ? (
            // 空会话：显示欢迎引导页
            <WelcomeScreen onQuickPrompt={handleQuickPrompt} />
          ) : (
            // Message Scroller + content-visibility（流式自动跟随 / 新 turn 锚定 / 跳到最新按钮）
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
          )}
        </div>
      </div>

      {/* 错误提示条：仅出错时展示（运行态已内联于消息流），置于底部避免顶部 layout shift */}
      {createElement(AgentStatus, {
        toolCalls: streamingToolCalls,
        error,
        onClearError: clearError
      })}

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
