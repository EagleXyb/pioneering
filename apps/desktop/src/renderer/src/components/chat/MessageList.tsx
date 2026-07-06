import { Bot } from 'lucide-react'
import { MessageBubble } from './MessageBubble'
import type { Message } from '@shared/types'

interface MessageListProps {
  messages: Message[]
  streamingContent?: string
  streamingMessageId?: string | null
  isStreaming?: boolean
}

export function MessageList({
  messages,
  streamingContent,
  streamingMessageId,
  isStreaming
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="text-center text-muted-foreground space-y-2">
          <Bot className="size-16 mx-auto opacity-20" />
          <p className="text-lg">开始新对话</p>
          <p className="text-sm">在下方输入消息，与 AI 助手交流</p>
        </div>
      </div>
    )
  }

  return (
    <div className="py-4">
      <div className="space-y-4">
        {messages.map((msg) => {
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
    </div>
  )
}
