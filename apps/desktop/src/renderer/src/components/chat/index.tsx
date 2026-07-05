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
  const [isFocused, setIsFocused] = useState(false)

  // 自动聚焦
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const charCount = value.length
  const charLimit = 10000
  const isNearLimit = charCount > charLimit * 0.9
  const isOverLimit = charCount > charLimit

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming || isOverLimit) return
    onSend(trimmed)
    setValue('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }, [value, isStreaming, isOverLimit, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const autoResize = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [])

  return (
    <div className="shrink-0 border-t border-border/60 bg-gradient-to-t from-background via-background to-transparent pt-2 pb-3 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 输入卡片容器 */}
        <div
          className={cn(
            'relative flex items-end gap-2 rounded-2xl border bg-card px-3 py-2.5 transition-all duration-200',
            isFocused
              ? 'border-primary/40 shadow-[0_0_0_1px_rgba(0,0,0,0.02)]'
              : 'border-input hover:border-muted-foreground/30'
          )}
        >
          {/* 附件按钮（占位） */}
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:text-muted-foreground hover:bg-accent/50 disabled:opacity-30"
            disabled={isStreaming}
            title="附件（即将支持）"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          {/* 文本输入区 */}
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              autoResize()
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="发消息给 AI..."
            rows={1}
            disabled={disabled}
            className="flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50 max-h-[160px] scrollbar-thin"
          />

          {/* 发送 / 停止 按钮 */}
          {isStreaming ? (
            <button
              onClick={onStop}
              className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-sm transition-all hover:bg-destructive/90 active:scale-95"
              title="停止生成"
            >
              <Square className="size-3.5" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!value.trim() || disabled || isOverLimit}
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-xl shadow-sm transition-all active:scale-95',
                value.trim() && !disabled && !isOverLimit
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground/50 cursor-not-allowed'
              )}
              title="发送 (Enter)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>

        {/* 底部工具栏：字数 */}
        <div className="flex items-center justify-end px-1 pt-1.5">

          {charCount > 0 && (
            <span
              className={cn(
                'text-[11px] tabular-nums transition-colors',
                isOverLimit
                  ? 'text-destructive font-medium'
                  : isNearLimit
                    ? 'text-amber-500'
                    : 'text-muted-foreground/40'
              )}
            >
              {charCount}{isNearLimit ? ` / ${charLimit}` : ''}
            </span>
          )}
        </div>
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
