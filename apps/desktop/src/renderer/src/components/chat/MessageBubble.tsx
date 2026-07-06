import { useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Copy, RefreshCw, ThumbsUp, ThumbsDown, Bot, User, Check } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Message } from '@/types/chat'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallCard } from './ToolCallCard'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  streamingContent?: string
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  streamingContent
}: MessageBubbleProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [liked, setLiked] = useState<'none' | 'like' | 'dislike'>('none')

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const displayContent = isStreaming && streamingContent !== undefined ? streamingContent : message.content

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn('flex gap-3 group', isUser && 'flex-row-reverse')}>
      <Avatar className="size-7 shrink-0 mt-1">
        <AvatarFallback
          className={cn(
            'text-xs',
            isUser ? 'bg-blue-500/20 text-blue-600' : 'bg-primary/20 text-primary'
          )}
        >
          {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
        </AvatarFallback>
      </Avatar>

      <div className={cn('flex flex-col gap-2 max-w-[85%]', isUser && 'items-end')}>
        {isAssistant && message.thinking && (
          <ThinkingBlock content={message.thinking.content} />
        )}

        {isAssistant && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-2">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {message.content && (
          <div
            className={cn(
              'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
              isUser
                ? 'bg-blue-600 text-white'
                : 'bg-muted/60 text-foreground'
            )}
          >
            {isAssistant || message.role === 'system' || message.role === 'tool' ? (
              <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {displayContent || (isStreaming ? '▊' : '')}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words">{displayContent}</p>
            )}
          </div>
        )}

        {isAssistant && !isStreaming && message.content && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="size-6" onClick={handleCopy} title="Copy">
              {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setLiked(liked === 'like' ? 'none' : 'like')}
              title="Like"
            >
              <ThumbsUp className={cn('size-3', liked === 'like' && 'text-blue-500')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setLiked(liked === 'dislike' ? 'none' : 'dislike')}
              title="Dislike"
            >
              <ThumbsDown className={cn('size-3', liked === 'dislike' && 'text-red-500')} />
            </Button>
            {message.model && (
              <span className="text-[10px] text-muted-foreground ml-1">{message.model}</span>
            )}
            {message.tokenUsage?.total && message.tokenUsage.total > 0 && (
              <span className="text-[10px] text-muted-foreground">{message.tokenUsage.total} tokens</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
