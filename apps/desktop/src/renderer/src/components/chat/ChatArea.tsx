// ============================================================
// ChatArea — 中栏对话区（消息流 + 输入框）
// ============================================================

import { useRef, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { AgentStatus } from './AgentStatus'
import { useChatStore } from '../../stores/chatStore'
import { useAgentStore } from '../../stores/useAgentStore'
import type { Message } from '@shared/types'

export function ChatArea() {
  const {
    sessions,
    currentSessionId,
    messages,
    streamingContent,
    streamingMessageId,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    clearError,
    loadSessions
  } = useChatStore()

  const { steps, currentStepIndex, status } = useAgentStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  const currentMessages: Message[] = currentSessionId ? messages[currentSessionId] || [] : []

  useEffect(() => {
    if (sessions.length === 0) {
      loadSessions()
    }
  }, [sessions.length, loadSessions])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [currentMessages, streamingContent, isStreaming])

  const handleSend = (content: string) => {
    sendMessage(content)
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Agent Status */}
      <AgentStatus
        steps={steps}
        currentStepIndex={currentStepIndex}
        isStreaming={isStreaming || status === 'running'}
        error={error}
        onClearError={clearError}
      />

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full" ref={scrollRef}>
          <div className="px-3">
            <MessageList
              messages={currentMessages}
              streamingContent={streamingContent}
              streamingMessageId={streamingMessageId}
              isStreaming={isStreaming}
            />
          </div>
        </ScrollArea>
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        disabled={false}
      />
    </div>
  )
}
