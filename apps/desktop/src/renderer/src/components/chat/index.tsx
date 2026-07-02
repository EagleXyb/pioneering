// ============================================================
// Chat UI Components — MessageBubble, MessageList, ChatInput, AgentStatus
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bot, User, Copy, Check, ThumbsUp, ThumbsDown, Send, Square } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import type { ChatMessage } from '@shared/types'
import { chatService } from '../../services/api'

// ==============================================================
// MessageBubble
// ==============================================================

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  isStreaming?: boolean
  model?: string
  tokenCount?: number
  onCopy?: () => void
  onLike?: () => void
  onDislike?: () => void
}

export function MessageBubble({
  role,
  content,
  isStreaming,
  model,
  tokenCount,
  onCopy,
  onLike,
  onDislike
}: MessageBubbleProps): JSX.Element {
  const [copied, setCopied] = useState(false)

  const isUser = role === 'user'
  const isAssistant = role === 'assistant'

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    onCopy?.()
  }

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-3 group',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="shrink-0 size-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="size-4 text-primary" />
        </div>
      )}

      <div className={cn('max-w-[75%]', isUser ? 'order-first' : '')}>
        {/* Bubble */}
        <div
          className={cn(
            'rounded-xl px-4 py-2.5 text-sm leading-relaxed',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground'
          )}
        >
          {isAssistant || role === 'system' || role === 'tool' ? (
            <div className="prose prose-sm dark:prose-invert max-w-none break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || (isStreaming ? '▊' : '')}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{content}</p>
          )}
        </div>

        {/* Meta & Actions */}
        {isAssistant && !isStreaming && content && (
          <div className="flex items-center gap-1 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="size-6" onClick={handleCopy} title="Copy">
              {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
            </Button>
            <Button variant="ghost" size="icon" className="size-6" onClick={onLike} title="Like">
              <ThumbsUp className="size-3" />
            </Button>
            <Button variant="ghost" size="icon" className="size-6" onClick={onDislike} title="Dislike">
              <ThumbsDown className="size-3" />
            </Button>
            {model && <span className="text-[10px] text-muted-foreground ml-1">{model}</span>}
            {tokenCount !== undefined && tokenCount > 0 && (
              <span className="text-[10px] text-muted-foreground">{tokenCount} tokens</span>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="shrink-0 size-8 rounded-full bg-blue-500/20 flex items-center justify-center">
          <User className="size-4 text-blue-500" />
        </div>
      )}
    </div>
  )
}

// ==============================================================
// MessageList
// ==============================================================

interface MessageListProps {
  messages: ChatMessage[]
  streamingContent?: string
  streamingMessageId?: string | null
  isStreaming?: boolean
}

export function MessageList({
  messages,
  streamingContent,
  streamingMessageId,
  isStreaming
}: MessageListProps): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground space-y-2">
          <Bot className="size-16 mx-auto opacity-20" />
          <p className="text-lg">开始新对话</p>
          <p className="text-sm">在下方输入消息，与 AI 助手交流</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto py-4">
      {messages.map((msg) => {
        const isStreamingMsg = isStreaming && msg.id === streamingMessageId
        return (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={isStreamingMsg && streamingContent ? streamingContent : msg.content}
            isStreaming={isStreamingMsg}
            model={msg.model}
            tokenCount={msg.tokenCount}
            onLike={() => chatService.sendFeedback(msg.id, 'like').catch(() => {})}
            onDislike={() => chatService.sendFeedback(msg.id, 'dislike').catch(() => {})}
          />
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}

// ==============================================================
// ChatInput
// ==============================================================

interface ChatInputProps {
  onSend: (content: string) => void
  onStop: () => void
  isStreaming: boolean
  disabled: boolean
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  disabled
}: ChatInputProps): JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setValue('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const autoResize = () => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`
    }
  }

  return (
    <div className="p-4 border-t border-border shrink-0">
      <div className="max-w-3xl mx-auto flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            autoResize()
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 max-h-[200px]"
        />
        {isStreaming ? (
          <Button
            onClick={onStop}
            variant="destructive"
            size="icon"
            className="shrink-0 rounded-xl"
            title="停止生成"
          >
            <Square className="size-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSend}
            size="icon"
            className="shrink-0 rounded-xl"
            disabled={!value.trim() || disabled}
            title="发送"
          >
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ==============================================================
// AgentStatus
// ==============================================================

interface AgentStatusProps {
  isStreaming: boolean
  error: string | null
  onClearError: () => void
}

export function AgentStatus({ isStreaming, error, onClearError }: AgentStatusProps): JSX.Element | null {
  if (!isStreaming && !error) return null

  return (
    <div className="px-4 py-2 border-b border-border shrink-0">
      <div className="max-w-3xl mx-auto flex items-center gap-2 text-sm">
        {isStreaming && (
          <div className="flex items-center gap-2 text-primary">
            <span className="relative flex size-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full size-2 bg-primary" />
            </span>
            <span>AI 正在生成...</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-red-500">
            <span>⚠ {error}</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClearError}>
              Dismiss
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
