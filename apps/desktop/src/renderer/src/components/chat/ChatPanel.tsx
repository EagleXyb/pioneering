import { useRef, useEffect, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Sparkles, ChevronDown, Plus, Settings2 } from 'lucide-react'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { AgentStatus } from './AgentStatus'
import { useChatStore } from '../../store/chatStore'
import { useAgentStore } from '../../stores/useAgentStore'
import type { Message } from '@/types/chat'

export function ChatPanel(): JSX.Element {
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

  const currentMessages: Message[] = currentSessionId ? messages[currentSessionId] || [] : []

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sessions.length === 0) {
      loadSessions()
    }
  }, [sessions.length, loadSessions])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [currentMessages, streamingContent])

  const handleSend = (content: string) => {
    sendMessage(content)
  }

  const currentSession = sessions.find((s) => s.id === currentSessionId)

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 text-sm font-medium hover:bg-muted px-2 py-1 rounded">
                {currentSession?.title || '新对话'}
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {sessions.map((session) => (
                <DropdownMenuItem key={session.id}>{session.title}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {currentSession?.model || '模型'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>GPT-4o</DropdownMenuItem>
              <DropdownMenuItem>Claude Sonnet 4</DropdownMenuItem>
              <DropdownMenuItem>DeepSeek V3</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="size-7">
            <Plus className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7">
            <Settings2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Agent Status */}
      <AgentStatus
        steps={steps}
        currentStepIndex={currentStepIndex}
        isStreaming={isStreaming}
        error={error}
        onClearError={clearError}
      />

      {/* Messages */}
      <div className="flex-1 overflow-hidden" ref={scrollRef}>
        <ScrollArea className="h-full">
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
