import { useState, memo, useRef, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { Copy, ThumbsUp, ThumbsDown, Check, RotateCcw, Share } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { useChatStore } from '@/stores/chatStore'
import { openLightboxAtom } from '@/stores/lightboxStore'
// T04：引入 shadcn/ui 官方 Message + Bubble 组件作为消息行布局外壳
import {
  Message,
  MessageContent,
  MessageFooter
} from '@/components/ui/message'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { cn } from '@/lib/utils'
import type { Message as ChatMessage, ToolCall, TraceNode } from '@shared/types'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallCard } from './ToolCallCard'
import { TraceNodeView } from './TraceNodeView'
import { TraceTreeRenderer, TraceTextNode } from './TraceTreeRenderer'
import { AgentTimeline } from './AgentTimeline'
// P3：通用文件附件卡片（非图片；图片仍走 message.images 通道）
import { AttachmentList } from './AttachmentList'
// P0：统一 Markdown 渲染器（sanitizeSchema/SafeLink/CodeBlock 已迁移至此，
// 非 trace 路径渲染产物与迁移前完全一致）
import { MarkdownRenderer } from './MarkdownRenderer'

interface MessageBubbleProps {
  message: ChatMessage
  isStreaming?: boolean
  streamingContent?: string
  streamingThinking?: string
  streamingToolCalls?: ToolCall[]
  /** M2: trace 树（流式期间用实时快照，历史消息用 message.traceNodes/traceRootOrder） */
  streamingTraceNodes?: Record<string, TraceNode>
  streamingTraceRootOrder?: string[]
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  streamingContent,
  streamingThinking,
  streamingToolCalls,
  streamingTraceNodes,
  streamingTraceRootOrder
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const [shared, setShared] = useState(false)
  const copyTimer = useRef<number | null>(null)
  const shareTimer = useRef<number | null>(null)
  const toggleMessageFeedback = useChatStore((s) => s.toggleMessageFeedback)
  const regenerateMessage = useChatStore((s) => s.regenerateMessage)
  // P1：用户图片点击 → 应用内 Lightbox 放大（替代新窗口打开 dataUrl）
  const openLightbox = useSetAtom(openLightboxAtom)

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
      if (shareTimer.current) clearTimeout(shareTimer.current)
    }
  }, [])

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const displayContent = isStreaming && streamingContent !== undefined ? streamingContent : message.content

  const feedback = message.feedback ?? 'none'

  // M2: 优先使用 trace 树，回退到扁平结构
  const traceNodes: Record<string, TraceNode> | undefined =
    isStreaming ? streamingTraceNodes : message.traceNodes
  const traceRootOrder: string[] | undefined =
    isStreaming ? streamingTraceRootOrder : message.traceRootOrder
  const useTrace = Boolean(traceNodes && traceRootOrder && traceRootOrder.length > 0)

  // 扁平模式下的数据
  const thinking = !useTrace ? (isStreaming ? streamingThinking : message.thinking?.content) : undefined
  const toolCalls = !useTrace ? (isStreaming ? streamingToolCalls : message.toolCalls) : undefined

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent)
    setCopied(true)
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  const handleRegenerate = () => {
    regenerateMessage(message.id)
  }

  const handleShare = async () => {
    try {
      if (navigator.share && displayContent) {
        await navigator.share({ text: displayContent, title: 'AI 回复' })
      } else {
        await navigator.clipboard.writeText(displayContent)
        setShared(true)
        shareTimer.current = window.setTimeout(() => setShared(false), 2000)
      }
    } catch {
      /* 用户取消或分享失败，静默处理 */
    }
  }

  // T04：用户消息右对齐（align="end"），助手/系统/工具消息左对齐（align="start"）
  const align = isUser ? 'end' : 'start'

  return (
  // T04：Message 作为消息行布局外壳，承担对齐 + 内容容器的组合（头像已隐藏）
  <Message align={align}>
      <MessageContent>
        {useTrace && isAssistant ? (
          traceNodes && traceRootOrder ? (
            <AgentTimeline
              nodes={traceNodes}
              rootOrder={traceRootOrder}
              isStreaming={isStreaming}
            />
          ) : null
        ) : (
          <>
            {/* T06：ThinkingBlock 内联于 MessageContent，置于气泡之前 */}
            {isAssistant && thinking && <ThinkingBlock content={thinking} isStreaming={isStreaming} />}

            {/* T06：ToolCallCard 内联于 MessageContent，置于气泡之前 */}
            {isAssistant && toolCalls && toolCalls.length > 0 && (
              <div className="space-y-2">
                {toolCalls.map((tc) => (
                  <ToolCallCard key={tc.id} toolCall={tc} />
                ))}
              </div>
            )}
          </>
        )}

        {/* 图片附件：保持原有的安全降级（非 image/* 不开 <a href>） */}
        {message.images && message.images.length > 0 && (
          <div className={cn('flex flex-wrap gap-2', isUser && 'justify-end')}>
            {message.images.map((img) => {
              // H8: 仅 mediaType 以 image/ 开头的附件才允许作为 <a href> 打开，
              // 否则（如 text/html 类型）以 data: URL 作为超链接会在新窗口渲染
              // 可被执行 HTML，构成钓鱼/HTML 注入面；非图片类型仅内联展示。
              const isImage = img.mediaType.startsWith('image/')
              const media = (
                <img src={img.dataUrl} alt="" className="size-full object-cover" />
              )
              if (isImage) {
                // P1：应用内 Lightbox 放大预览（替代 <a target="_blank"> 新窗口打开）。
                // 缩略图尺寸/圆角/边框样式与布局保持不变；H8 的 mediaType 门控不变。
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => openLightbox(img.dataUrl)}
                    className="block size-20 cursor-zoom-in overflow-hidden rounded-lg border bg-muted"
                    aria-label="放大查看图片"
                  >
                    {media}
                  </button>
                )
              }
              return (
                <div
                  key={img.id}
                  className="block size-20 overflow-hidden rounded-lg border bg-muted"
                >
                  {media}
                </div>
              )
            })}
          </div>
        )}

        {/* P3：通用文件附件（非图片；无附件时不渲染，布局与此前完全一致） */}
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentList attachments={message.attachments} isUser={isUser} />
        )}

        {(displayContent || message.content || isStreaming || useTrace) && (
          <Bubble
            variant={isUser ? 'secondary' : 'ghost'}
            align={align}
            className={cn(
              isUser
                ? ''
                : 'w-full max-w-full'
            )}
          >
            <BubbleContent
              role={isAssistant && isStreaming ? 'status' : undefined}
              aria-live={isAssistant && isStreaming ? 'polite' : undefined}
              aria-atomic={isAssistant && isStreaming ? 'false' : undefined}
              aria-label={
                isAssistant
                  ? isStreaming
                    ? '助手正在回复'
                    : '助手消息'
                  : undefined
              }
              className={cn(
                'min-w-0 rounded-2xl py-2.5 leading-relaxed',
                isUser && 'px-4 text-sm',
                // P1：助手消息无背景、全宽、字号略大，对齐 WorkBuddy 排版
                !isUser && 'w-full max-w-full px-0 text-[15px] text-foreground'
              )}
            >
              {/* M2/M6: trace 模式下 text 节点由 TraceTextNode 统一渲染（含 markdown、光标、动画）；
                  非 trace 路径经 P0 统一为 MarkdownRenderer（渲染产物与迁移前完全一致） */}
              {useTrace && isAssistant ? (
                traceNodes && traceRootOrder ? (
                  <TraceTextNode nodes={traceNodes} rootIds={traceRootOrder} />
                ) : isStreaming ? (
                  <span className="inline-block h-4 w-1.5 animate-pulse bg-current" aria-hidden>▊</span>
                ) : null
              ) : (isAssistant || message.role === 'system' || message.role === 'tool') ? (
                <MarkdownRenderer
                  content={displayContent || (isStreaming ? '▊' : '')}
                  messageId={message.id}
                />
              ) : (
                <p className="whitespace-pre-wrap break-words">{displayContent}</p>
              )}
            </BubbleContent>
          </Bubble>
        )}

        {/* T07：actions 由 MessageFooter 承载，align="end" 时自动右对齐 */}
        {isAssistant && !isStreaming && message.content && (
          <MessageFooter className="opacity-0 group-hover/message:opacity-100 transition-opacity gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={handleCopy}
                  aria-label={copied ? '已复制' : '复制消息内容'}
                >
                  {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{copied ? '已复制' : '复制'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => toggleMessageFeedback(message.id, feedback === 'like' ? 'none' : 'like')}
                  aria-label={feedback === 'like' ? '取消赞' : '赞'}
                  aria-pressed={feedback === 'like'}
                >
                  <ThumbsUp className={cn('size-3', feedback === 'like' && 'text-blue-500')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">赞</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => toggleMessageFeedback(message.id, feedback === 'dislike' ? 'none' : 'dislike')}
                  aria-label={feedback === 'dislike' ? '取消踩' : '踩'}
                  aria-pressed={feedback === 'dislike'}
                >
                  <ThumbsDown className={cn('size-3', feedback === 'dislike' && 'text-red-500')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">踩</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={handleRegenerate}
                  aria-label="重新生成回复"
                >
                  <RotateCcw className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">重新生成</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={handleShare}
                  aria-label={shared ? '内容已复制' : '分享此消息'}
                >
                  {shared ? <Check className="size-3 text-green-500" /> : <Share className="size-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{shared ? '已复制' : '分享'}</TooltipContent>
            </Tooltip>
            {message.model && (
              <span className="text-[10px] text-muted-foreground ml-1">{message.model}</span>
            )}
            {message.tokenUsage?.total && message.tokenUsage.total > 0 && (
              <span className="text-[10px] text-muted-foreground">{message.tokenUsage.total} tokens</span>
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
})
