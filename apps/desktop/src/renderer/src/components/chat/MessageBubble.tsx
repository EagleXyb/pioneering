import { useState, memo, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import { defaultSchema, type Schema as SanitizeSchema } from 'hast-util-sanitize'
import { useSetAtom } from 'jotai'
import { Copy, ThumbsUp, ThumbsDown, Check, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openArtifactAtom } from '@/stores/artifactStore'
import { getHastText, previewableLanguage, getCodeLanguage } from '@/lib/extractCodeBlocks'
// T04：引入 shadcn/ui 官方 Message + Bubble 组件作为消息行布局外壳
import {
  Message,
  MessageContent,
  MessageFooter
} from '@/components/ui/message'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { cn } from '@/lib/utils'
import type { Message as ChatMessage, ToolCall } from '@shared/types'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallCard } from './ToolCallCard'

// H7: 自定义 sanitize schema —— 在默认安全白名单基础上保留
// GFM 表格与 rehype-highlight 高亮所需的 className（语言/ token 着色），
// 同时限制 href 仅允许 http(s):// / mailto 协议，剥离 on* 事件与危险协议。
const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        '*'
      ] as string[] | undefined) ?? [],
      'className'
    ],
    code: [
      ...((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        'code'
      ] as string[] | undefined) ?? [],
      'className'
    ],
    span: [
      ...((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        'span'
      ] as string[] | undefined) ?? [],
      'className'
    ],
    a: [
      ...((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        'a'
      ] as string[] | undefined) ?? [],
      'href',
      'target',
      'rel'
    ]
  },
  protocols: {
    // 限制所有 href 属性仅允许安全协议（默认含 irc/ircs/xmpp，这里收紧为 http(s)/mailto）
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto']
  }
}

// H7: 渲染阶段对链接 href 再做一次白名单，仅放行 http(s)://；
// 其它（如 javascript: / 相对危险链接）降级为纯文本，阻断 XSS 跳转/脚本执行。
function SafeLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safe = typeof href === 'string' && /^https?:\/\//i.test(href)
  if (!safe) {
    // 非安全链接降级为纯文本（剥离锚点）；将剩余属性断言为 span 属性后再展开，
    // 避免 JSX 内联 as 转换的解析歧义。
    const spanProps = props as React.HTMLAttributes<HTMLSpanElement>
    return <span {...spanProps}>{children}</span>
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </a>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
  isStreaming?: boolean
  streamingContent?: string
  streamingThinking?: string
  streamingToolCalls?: ToolCall[]
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  streamingContent,
  streamingThinking,
  streamingToolCalls
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const [liked, setLiked] = useState<'none' | 'like' | 'dislike'>('none')
  const copyTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const displayContent = isStreaming && streamingContent !== undefined ? streamingContent : message.content

  // 流式期间优先显示实时推理/工具轨迹，结束回退到落库数据
  const thinking = isStreaming ? streamingThinking : message.thinking?.content
  const toolCalls = isStreaming ? streamingToolCalls : message.toolCalls

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent)
    setCopied(true)
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  // 预览入口：点击代码块的「预览」按钮 → 打开右侧预览面板（自动展开右栏）
  const openArtifact = useSetAtom(openArtifactAtom)

  /**
   * 自定义代码块渲染：在 assistant 消息的 html / svg 代码块上附加「预览」按钮。
   * - pre 改为透传，避免默认 <pre> 再次包裹我们自定义的卡片结构（div 不能嵌在 pre 内）。
   * - 行内代码（无 language、无换行）→ 原样渲染；围栏代码块 → 带语言标签的卡片，
   *   仅 html / svg 显示「预览」按钮，点击把原始 code 传给 openArtifact。
   */
  const CodeBlock = useCallback(
    ({ node, className, children, ...rest }: any) => {
      const raw = getHastText(node)
      const lang = previewableLanguage(className)
      const hasLang = Boolean(className && /language-/.test(className))
      const isBlock = hasLang || raw.includes('\n')
      if (!isBlock) {
        return <code className={className} {...rest}>{children}</code>
      }
      return (
        <div className="group/code relative my-2 overflow-hidden rounded-lg border border-border/60 bg-muted [&>pre]:m-0 [&>pre]:rounded-none [&>pre]:bg-transparent [&>pre]:p-0">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-1">
            <span className="font-mono text-[11px] uppercase text-muted-foreground">
              {lang ?? (hasLang ? getCodeLanguage(className) : 'code')}
            </span>
            {lang && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px] text-primary"
                onClick={() =>
                  openArtifact({
                    messageId: message.id,
                    type: lang,
                    content: raw,
                    language: lang
                  })
                }
              >
                <Eye className="size-3" /> 预览
              </Button>
            )}
          </div>
          <pre className="overflow-x-auto p-3 font-mono text-[0.85em] leading-relaxed">
            <code className={className} {...rest}>{children}</code>
          </pre>
        </div>
      )
    },
    [message.id, openArtifact]
  )

  // T04：用户消息右对齐（align="end"），助手/系统/工具消息左对齐（align="start"）
  const align = isUser ? 'end' : 'start'

  return (
  // T04：Message 作为消息行布局外壳，承担对齐 + 内容容器的组合（头像已隐藏）
  <Message align={align}>
      <MessageContent>
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
                return (
                  <a
                    key={img.id}
                    href={img.dataUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block size-20 overflow-hidden rounded-lg border bg-muted"
                  >
                    {media}
                  </a>
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

        {(displayContent || message.content || isStreaming) && (
          // T04：Bubble 作为消息可见表面；用户消息沿用蓝色（保留原视觉），
          // 助手消息使用 muted variant（与原 bg-muted/60 一致）。
          // T03 a11y：流式输出期间让 AT 朗读新内容；助手消息作为 live region 通告更新。
          <Bubble
            variant={isUser ? 'default' : 'muted'}
            align={align}
            className={cn(
              isUser
                ? '[&>[data-slot=bubble-content]]:bg-[#e5e7eb] [&>[data-slot=bubble-content]]:text-foreground'
                : 'w-full max-w-full'
            )}
          >
            <BubbleContent
              // T03 a11y：role/aria-live/aria-atomic 仅在流式助手消息上启用
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
                'min-w-0 rounded-2xl py-2.5 text-sm leading-relaxed',
                // 用户消息：左右内边距 16px；助手消息：左右内边距 0px 并填满内容区
                isUser && 'px-4 bg-[#e5e7eb] text-foreground border-transparent',
                !isUser && 'px-0 !bg-transparent text-foreground border-transparent'
              )}
            >
              {isAssistant || message.role === 'system' || message.role === 'tool' ? (
                <div className="chat-markdown max-w-none break-words">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
                    components={{ a: SafeLink, pre: ({ children }) => <>{children}</>, code: CodeBlock }}
                  >
                    {displayContent || (isStreaming ? '▊' : '')}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">{displayContent}</p>
              )}
            </BubbleContent>
          </Bubble>
        )}

        {/* T07：actions 由 MessageFooter 承载，align="end" 时自动右对齐 */}
        {isAssistant && !isStreaming && message.content && (
          <MessageFooter className="opacity-0 group-hover/message:opacity-100 transition-opacity gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={handleCopy}
              title="复制"
              aria-label={copied ? '已复制' : '复制消息内容'}
            >
              {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setLiked(liked === 'like' ? 'none' : 'like')}
              title="赞"
              aria-label={liked === 'like' ? '取消赞' : '赞'}
              aria-pressed={liked === 'like'}
            >
              <ThumbsUp className={cn('size-3', liked === 'like' && 'text-blue-500')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setLiked(liked === 'dislike' ? 'none' : 'dislike')}
              title="踩"
              aria-label={liked === 'dislike' ? '取消踩' : '踩'}
              aria-pressed={liked === 'dislike'}
            >
              <ThumbsDown className={cn('size-3', liked === 'dislike' && 'text-red-500')} />
            </Button>
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
