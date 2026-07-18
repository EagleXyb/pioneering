// ============================================================
// ChatArea — 中栏对话区（消息流 + 输入框）
// ============================================================

import { useRef, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from './MessageList'
import { InputArea, type InputAreaSendOptions } from './input/InputArea'
import { AgentStatus } from './AgentStatus'
import { useChatStore } from '../../stores/chatStore'
import type { Message } from '@shared/types'
import type { ImageAttachment } from '@/lib/input/image-attachments'

export function ChatArea() {
  // 逐项选择器订阅，避免全量重渲染（流式期间仅 streaming* 触发重渲染）
  const sessionsLength = useChatStore((s) => s.sessions.length)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const messages = useChatStore((s) => s.messages)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const streamingThinking = useChatStore((s) => s.streamingThinking)
  const streamingToolCalls = useChatStore((s) => s.streamingToolCalls)
  const streamingMessageId = useChatStore((s) => s.streamingMessageId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const agentMode = useChatStore((s) => s.agentMode)
  const setAgentMode = useChatStore((s) => s.setAgentMode)
  const error = useChatStore((s) => s.error)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stopStreaming = useChatStore((s) => s.stopStreaming)
  const clearError = useChatStore((s) => s.clearError)
  const loadSessions = useChatStore((s) => s.loadSessions)

  const scrollRef = useRef<HTMLDivElement>(null)
  // B8: 记录用户是否在底部附近，用于判断流式输出时是否自动滚动。
  // 仅当用户在底部附近才自动滚动，避免用户向上回看历史时被强制拉回底部。
  const isNearBottomRef = useRef(true)

  const currentMessages: Message[] = currentSessionId ? messages[currentSessionId] || [] : []

  useEffect(() => {
    if (sessionsLength === 0) {
      loadSessions()
    }
  }, [sessionsLength, loadSessions])

  // B8: 监听滚动位置，更新 isNearBottomRef
  useEffect(() => {
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
  }, [])

  useEffect(() => {
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
  }, [currentMessages, streamingContent, streamingThinking, streamingToolCalls, isStreaming])

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

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full" ref={scrollRef}>
          <div className="min-h-full px-3">
            <MessageList
              messages={currentMessages}
              streamingContent={streamingContent}
              streamingThinking={streamingThinking}
              streamingToolCalls={streamingToolCalls}
              streamingMessageId={streamingMessageId}
              isStreaming={isStreaming}
              scrollElementRef={scrollRef}
            />
          </div>
        </ScrollArea>
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
    </div>
  )
}
