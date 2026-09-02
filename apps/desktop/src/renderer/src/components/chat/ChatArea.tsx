// ============================================================
// ChatArea — 中栏对话区（消息流 + 输入框）
// ============================================================
//
// 收敛说明（原 T10/T11/T12/T13/T14 feature flag 已移除）：
//   - 消息列表统一使用 MessageScrollerList（@shadcn/react + content-visibility）
//   - legacy ScrollArea + MessageList（虚拟化 + isNearBottomRef）已删除
//   - 流式自动跟随由 MessageScrollerProvider.autoScroll 接管
//   - 滚动感知顶部栏的逻辑保留，统一查询 message-scroller-viewport
//
// 布局模式：
//   - 欢迎页模式（showWelcome=true）：整体垂直居中，InputArea 随欢迎内容流居中
//   - 聊天模式（showWelcome=false）：三段式——消息区 flex-1 overflow / AgentStatus / InputArea
// ============================================================

import { useRef, useEffect, useMemo, useCallback, useState, createElement } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { chatScrolledAtom, chatWelcomeModeAtom } from '@/stores/atoms'
import { MessageScrollerList } from './MessageScrollerList'
import { WelcomeScreenTop, WelcomeScreenBottom } from './WelcomeScreen'
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
  // 阶段三 3.4：HITL 暂停态输入区切精简态
  const isHitlPaused = useChatStore((s) => s.isHitlPaused)

  // T09：dev-only 压测开关
  const devStress = useFeatureFlag('devStressMessages')
  const devStressCount = useFeatureFlag('devStressCount')

  // 消息区容器 ref：用于定位滚动容器，驱动顶部栏下边框显隐
  const messagesPaneRef = useRef<HTMLDivElement>(null)

  // 滚动感知顶部栏：消息区滚动离开顶部（scrollTop > 0）时，
  // ChatHeader 显示下边框；回到顶部/无滚动容器（欢迎页、内容不足一屏）时隐藏。
  const setChatScrolled = useSetAtom(chatScrolledAtom)

  // 欢迎页模式状态：同步到 chatWelcomeModeAtom 供 RootLayout 隐藏顶部栏
  const setChatWelcomeMode = useSetAtom(chatWelcomeModeAtom)

  // 欢迎页功能标签选中态（Top 组件切换时同步给 Bottom 组件）
  const [welcomeFeature, setWelcomeFeature] = useState('doc')

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

  // 同步欢迎页模式到 atom，供 RootLayout 控制顶部栏显隐
  useEffect(() => {
    setChatWelcomeMode(showWelcome)
    return () => setChatWelcomeMode(false)
  }, [showWelcome, setChatWelcomeMode])

  // 滚动感知顶部栏：消息区滚动离开顶部（scrollTop > 0）时，
  // ChatHeader 显示下边框；回到顶部/无滚动容器（欢迎页、内容不足一屏）时隐藏。
  useEffect(() => {
    if (showWelcome) {
      setChatScrolled(false)
      return
    }
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

  // ============================================================
  // 欢迎页模式：整体垂直居中
  // 布局顺序对齐 TRAE 参考图：
  //   标题 → 功能标签 → 输入框 → 模板卡片
  // ============================================================
  if (showWelcome) {
    return (
      <div className="flex flex-col h-full bg-background overflow-y-auto">
        <div className="flex flex-col min-h-full w-full">
          {/* 上半弹性占位：把「标题+标签+输入框」推到窗口正中间 */}
          <div className="flex-1 min-h-0 shrink-0" />

          {/* 居中主体：「标题+标签+输入框」整体下移 20px（translate 不占布局空间）；
              推荐区仍按结构位置 pt-[116px]，视觉位置不变 */}
          <div
            className="w-full flex flex-col items-center px-6"
            style={{
              maxWidth: 'var(--chat-col-max)',
              marginInline: 'auto',
              paddingTop: 0,
              paddingBottom: 0,
              marginTop: -50,
              marginBottom: -50
            }}
          >
            <div
              className="w-full flex flex-col items-center gap-6 translate-y-[40px]"
              style={{ height: 259, paddingTop: 0, paddingBottom: 25 }}
            >
              <WelcomeScreenTop onFeatureChange={setWelcomeFeature} />

              <div className="w-full">
                <InputArea
                  sessionId={currentSessionId}
                  onSend={handleSend}
                  onStop={stopStreaming}
                  isStreaming={isStreaming}
                  disabled={false}
                  agentMode={agentMode}
                  onToggleAgent={() => setAgentMode(!agentMode)}
                  isWelcome={true}
                  mode={isHitlPaused ? 'hitl' : 'normal'}
                />
              </div>
            </div>

            {/* 推荐区：整体下移 20px —— 用 translate 而非 padding。
                上下 flex-1 垂直居中会均分吸收中间内容的高度变化（padding+20 只能下移 ~10px），
                translate 不占布局空间，可保证完整下移 20px（与上方标题块下移手法一致）。 */}
            <div
              className="w-full translate-y-5"
              style={{ paddingTop: 80, paddingBottom: 80, marginTop: -16, marginBottom: -16 }}
            >
              <WelcomeScreenBottom activeFeature={welcomeFeature} onQuickPrompt={handleQuickPrompt} />
            </div>
          </div>

          {/* 下半弹性占位：固定 110px 高度 */}
          <div className="w-full h-[110px]" />
        </div>

        {/* 错误提示条（欢迎态也可能出错，例如发消息失败） */}
        {createElement(AgentStatus, {
          toolCalls: streamingToolCalls,
          error,
          onClearError: clearError
        })}

        {/* P1：图片放大预览 Lightbox（Portal 挂载，关闭时不渲染任何 DOM） */}
        <ImageLightbox />
      </div>
    )
  }

  // ============================================================
  // 聊天模式：三段式——消息区 flex-1 / AgentStatus / InputArea
  // ============================================================
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages：与输入框同宽（由 --chat-col-max 令牌统一约束，既定 880px）并居中 */}
      <div className="chat-messages-pane flex-1 overflow-hidden" ref={messagesPaneRef}>
        <div className="mx-auto h-full w-full max-w-[var(--chat-col-max)] px-0">
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
        isWelcome={false}
        mode={isHitlPaused ? 'hitl' : 'normal'}
      />

      {/* P1：图片放大预览 Lightbox（Portal 挂载，关闭时不渲染任何 DOM） */}
      <ImageLightbox />
    </div>
  )
}
