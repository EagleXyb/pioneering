// ============================================================
// ChatArea — 中栏对话区（消息流 + 输入框）
// ============================================================

import { useRef, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBubble } from './MessageBubble'
import { ChatInput } from './ChatInput'
import { AgentStatus } from './AgentStatus'
import { useChatStore } from '../../stores/chatStore'
import { useAgentStore } from '../../stores/useAgentStore'
import { Bot } from 'lucide-react'
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
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="max-w-3xl mx-auto px-4 py-6">
          {currentMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">How can I help you today?</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Ask me to write code, debug issues, or automate your workflow.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {currentMessages.map((msg) => {
                const isStreamingMsg = isStreaming && msg.id === streamingMessageId
                return (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    isStreaming={isStreamingMsg}
                    streamingContent={isStreamingMsg ? streamingContent : undefined}
                  />
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="shrink-0 bg-background">
        <ChatInput
          onSend={handleSend}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          disabled={false}
        />
      </div>
    </div>
  )
}
