import { useState, memo, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { useSetAtom } from 'jotai'
import { Copy, ThumbsUp, ThumbsDown, Check, RotateCcw, Share, MessageCircleQuestion, ShieldCheck, ListChecks, ClipboardCheck, ChevronDown, ChevronUp, Info, PencilLine } from 'lucide-react'
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
import { formatMessageTime } from '@/lib/formatTime'
import type { Message as ChatMessage, ToolCall, TraceNode } from '@shared/types'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallCard, ToolBatchRow, groupToolCalls } from './ToolCallCard'
import { ProcessBlock } from './ProcessBlock'
import { TraceTextNode } from './TraceTreeRenderer'
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
  /** 用户消息是否可编辑（会话空闲且已持久化时由父层传入） */
  editable?: boolean
  /** 是否处于编辑态（同一时刻仅一条） */
  editing?: boolean
  /** 编辑提交中（禁用取消/发送） */
  submittingEdit?: boolean
  onStartEdit?: () => void
  onCancelEdit?: () => void
  onSubmitEdit?: (nextText: string) => void | Promise<void>
}

/** 用户气泡折叠态展示的正文行数（对齐 web UserMessageBubble） */
const COLLAPSED_LINES = 5

/** 编辑提示：明确"重新开始对话"的后果与产物保留策略（对齐 web） */
const EDIT_HINT = '编辑后将从此处重新开始对话，后续消息会被新回复替换；已有产物不会被删除'

/**
 * 用户消息行内编辑器（对齐 web UserMessageBubble 的编辑态）：
 * 多行文本框 + 提示条 + 取消/发送；Enter 发送、Shift+Enter 换行、Esc 取消，
 * IME 合成中的 Enter 不发送。
 */
function UserMessageEditor({
  initialText,
  submitting,
  onSubmit,
  onCancel
}: {
  initialText: string
  submitting: boolean
  onSubmit: (text: string) => void | Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自动增高：44px 起步、240px 封顶
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = ''
    const height = Math.min(240, Math.max(44, el.scrollHeight))
    el.style.height = `${height}px`
  }, [value])

  // 进入编辑态聚焦并把光标置于末尾
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const end = el.value.length
      try {
        el.setSelectionRange(end, end)
      } catch {
        // 忽略不支持选区的情况
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [])

  const canSubmit = !submitting && value.trim().length > 0

  const handleSubmit = () => {
    if (!canSubmit) return
    void onSubmit(value.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (!submitting) onCancel()
      return
    }
    if (e.key !== 'Enter') return
    // IME 合成中的 Enter 用于确认候选词，不触发发送
    if (e.nativeEvent.isComposing) return
    if (e.shiftKey) return
    e.preventDefault()
    handleSubmit()
  }

  return (
    <div className="w-full min-w-[380px] rounded-[12px] border border-[rgba(59,130,246,0.42)] bg-card p-2 pb-1.5 shadow-sm">
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        spellCheck={false}
        aria-label="编辑消息"
        aria-busy={submitting || undefined}
        className="block min-h-[44px] max-h-[240px] w-full resize-none bg-transparent px-1 py-0.5 text-[14px] leading-[1.6] text-foreground outline-none"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs leading-[1.5] text-muted-foreground">
          <Info className="size-[13px] shrink-0" aria-hidden />
          {EDIT_HINT}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="h-[30px] rounded-[8px] px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-[30px] rounded-[8px] bg-foreground px-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? '发送中…' : '发送'}
          </button>
        </span>
      </div>
    </div>
  )
}

/** 已处理耗时：从暂停消息产生起每秒刷新（120s 超时内即可读到秒级反馈） */
function useElapsedSeconds(start: number): number {
  const [secs, setSecs] = useState(() => Math.max(0, Math.floor((Date.now() - start) / 1000)))
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecs(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [start])
  return secs
}

function formatElapsed(total: number): string {
  if (total < 60) return `已处理 ${total} 秒`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `已处理 ${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`
}

/**
 * HITL 暂停状态头：已处理耗时 + 虚线分隔 + 等待状态。
 * 暂停的半截消息不落库、内容可能为空，状态头保证用户看到
 * "Agent 正在询问/等待"以及本次中断已持续多久，而不是空白气泡。
 */
function HitlPausedHeader({ kind, timestamp }: { kind?: ChatMessage['pausedKind']; timestamp: number }) {
  const secs = useElapsedSeconds(timestamp)
  const { Icon, text } = (() => {
    switch (kind) {
      case 'tool_confirm':
        return { Icon: ShieldCheck, text: '等待你确认该操作' }
      case 'choice':
        return { Icon: ListChecks, text: '等待你选择' }
      case 'plan_confirm':
        return { Icon: ClipboardCheck, text: '等待你确认方案' }
      case 'clarifying':
      default:
        return { Icon: MessageCircleQuestion, text: '正在询问用户' }
    }
  })()
  return (
    <div className="mb-2" role="status" aria-live="polite">
      <div className="text-xs text-muted-foreground">{formatElapsed(secs)}</div>
      <div className="mt-1.5 border-t border-dashed border-border" />
      <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {text}
      </div>
    </div>
  )
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  streamingContent,
  streamingThinking,
  streamingToolCalls,
  streamingTraceNodes,
  streamingTraceRootOrder,
  editable,
  editing,
  submittingEdit,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit
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

  // 连续同类工具调用聚合（对齐 web 分析模式 renderBlocks 的分组规则：
  // 一轮并列的多条同类调用收成一行批次摘要，减少消息区噪声）
  const toolRows = useMemo(
    () => (toolCalls && toolCalls.length > 0 ? groupToolCalls(toolCalls) : []),
    [toolCalls]
  )

  // 扁平路径历史消息的过程耗时：由工具起止时间推导（对齐 web ProcessContainer
  // 的 durationMs 数据来源；实时流缺省时由 ProcessBlock 本地计时）
  const flatDurationMs = useMemo(() => {
    if (isStreaming || !toolCalls) return null
    const starts = toolCalls.map((t) => t.startTime).filter((v): v is number => !!v)
    const ends = toolCalls.map((t) => t.endTime).filter((v): v is number => !!v)
    if (starts.length === 0 || ends.length === 0) return null
    const d = Math.max(...ends) - Math.min(...starts)
    return d > 0 ? d : null
  }, [isStreaming, toolCalls])

  // ===== 用户消息超长折叠（对齐 web UserMessageBubble：超 5 行默认折叠） =====
  const userContentRef = useRef<HTMLParagraphElement>(null)
  const [userExpanded, setUserExpanded] = useState(false)
  const [userOverflowing, setUserOverflowing] = useState(false)
  const userCanToggle = isUser && userOverflowing
  const userCollapsed = userCanToggle && !userExpanded

  // 溢出判定：测量正文内容层高度 —— 不受折叠 max-height 裁剪影响；
  // 内容或宽度变化（图片加载、窗口缩放）时经 ResizeObserver 重测
  useLayoutEffect(() => {
    if (!isUser) return
    const content = userContentRef.current
    if (!content) return
    const measure = () => {
      const lh = parseFloat(window.getComputedStyle(content).lineHeight)
      const line = Number.isFinite(lh) && lh > 0 ? lh : 14 * 1.6
      const over = content.offsetHeight > line * COLLAPSED_LINES + 1
      setUserOverflowing((prev) => (prev === over ? prev : over))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(content)
    return () => ro.disconnect()
  }, [isUser, displayContent])

  // 组件实例被复用到另一条消息时回到折叠态
  useEffect(() => {
    setUserExpanded(false)
  }, [message.id])

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent)
    setCopied(true)
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  /** 点击气泡本体切换折叠；拖选文本或点击气泡内链接时不触发（对齐 web） */
  const handleBubbleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('a')) return
    if (window.getSelection()?.toString()) return
    setUserExpanded((v) => !v)
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

  // 用户消息时间（悬停元信息行，对齐 web formatMessageTime 口径）
  const userTimeText = isUser ? formatMessageTime(message.timestamp) : ''

  // 空回复兜底（对齐 web 分析模式）：run 结束但没有任何最终回答时给出提示，
  // 避免整条消息在界面上完全消失（用户无从判断「没回复」还是「页面坏了」）。
  const isPausedEmpty = Boolean(isAssistant && message.paused)
  const showEmptyResponse =
    isAssistant &&
    !isStreaming &&
    !useTrace &&
    !displayContent?.trim() &&
    !thinking &&
    (!toolCalls || toolCalls.length === 0) &&
    !isPausedEmpty

  return (
  // T04：Message 作为消息行布局外壳，承担对齐 + 内容容器的组合（头像已隐藏）
  <Message align={align}>
      <MessageContent>
        {/* HITL 暂停状态头：暂停的半截消息不落库、内容可能为空，
            耗时+虚线+状态保证用户能看到"正在询问/等待"而不是空白气泡 */}
        {isAssistant && message.paused && (
          <HitlPausedHeader kind={message.pausedKind} timestamp={message.timestamp} />
        )}
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
            {/* 扁平路径：思考块 + 工具动作行收进过程容器（对齐 web 分析模式
                TaoBlockSequence）——运行中展开并计时，终态收起为一行摘要，
                正文区只留最终回答，多轮过程不再把消息撑长 */}
            {isAssistant && (thinking || toolRows.length > 0) && (
              <ProcessBlock streaming={isStreaming} durationMs={flatDurationMs}>
                {thinking && <ThinkingBlock content={thinking} isStreaming={isStreaming} />}
                {toolRows.map((row) =>
                  row.type === 'batch' ? (
                    <ToolBatchRow
                      key={`batch-${row.items[0]?.id ?? row.kind}`}
                      kind={row.kind}
                      items={row.items}
                    />
                  ) : (
                    <ToolCallCard key={row.toolCall.id} toolCall={row.toolCall} />
                  )
                )}
              </ProcessBlock>
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

        {(displayContent || message.content || isStreaming || useTrace) && !editing && (
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
                'min-w-0 py-2.5 leading-relaxed',
                // 用户气泡：对齐 web 排版规范（14px/1.6、padding 9×14、圆角 12，
                // 字号走 rem 跟随全局字体档位）；超 5 行可折叠时右下角预留按钮行
                isUser && cn(
                  'relative rounded-xl px-3.5 py-[9px] text-[1rem] leading-[1.6]',
                  userCanToggle && 'pb-[29px] cursor-pointer'
                ),
                // P1：助手消息无背景、全宽、字号略大，对齐 WorkBuddy 排版
                !isUser && 'w-full max-w-full px-0 text-[15px] text-foreground'
              )}
              onClick={userCanToggle ? handleBubbleClick : undefined}
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
                <>
                  {/* 折叠裁剪层（限高 5 行）> 正文测量层：测量层自身高度始终为
                      完整内容高度，折叠 / 展开两态判定一致（对齐 web 双层结构） */}
                  <div className={cn(userCollapsed && 'max-h-[8rem] overflow-hidden')}>
                    <p ref={userContentRef} className="whitespace-pre-wrap break-words">
                      {displayContent}
                    </p>
                  </div>
                  {/* 折叠态正文区底部渐隐：覆盖层与气泡同底色、向上透明，
                      只覆盖正文（bottom = 底部按钮行的 29px），不压住「展开」按钮 */}
                  {userCollapsed && (
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-[29px] h-[26px] bg-gradient-to-t from-secondary to-transparent"
                      aria-hidden
                    />
                  )}
                  {/* 超长消息的折叠开关（气泡右下角文字按钮，仅内容超 5 行时出现） */}
                  {userCanToggle && (
                    <button
                      type="button"
                      className="absolute bottom-1.5 right-2.5 z-[1] inline-flex items-center gap-0.5 rounded-md px-[5px] py-0.5 text-[13px] font-medium leading-[1.2] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={userExpanded ? '收起消息' : '展开消息'}
                      aria-expanded={userExpanded}
                      onClick={(e) => {
                        e.stopPropagation()
                        setUserExpanded((v) => !v)
                      }}
                    >
                      {userExpanded ? '收起' : '展开'}
                      {userExpanded ? (
                        <ChevronUp className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      )}
                    </button>
                  )}
                </>
              )}
            </BubbleContent>
          </Bubble>
        )}

        {/* 编辑态：用行内编辑卡片替换原气泡（对齐 web UserMessageBubble） */}
        {isUser && editing && (
          <UserMessageEditor
            initialText={displayContent}
            submitting={!!submittingEdit}
            onSubmit={(next) => onSubmitEdit?.(next)}
            onCancel={() => onCancelEdit?.()}
          />
        )}

        {/* P3：通用文件附件（非图片）置于正文之后、点赞点踩栏之前 */}
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentList attachments={message.attachments} isUser={isUser} />
        )}

        {/* 空回复兜底：run 结束但没有任何最终回答（可能达到工具上限或被中止） */}
        {showEmptyResponse && (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm leading-relaxed text-muted-foreground">
            Agent 本轮未产出完整回答（可能已达到工具调用上限或被中止）。
            可以重试、缩小问题范围，或直接要求「用已有信息作答」。
          </p>
        )}

        {/* 用户消息悬停元信息行（时间 / 编辑 / 复制），对齐 web UserMessageBubble：
            28px 圆角操作钮 + 12px 时间，默认透明，hover / focus-within 显示 */}
        {isUser && !editing && (
          <MessageFooter className="mt-1 min-h-7 gap-0.5 px-0 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
            {userTimeText && (
              <span className="mr-1 text-xs text-muted-foreground whitespace-nowrap select-none">
                {userTimeText}
              </span>
            )}
            {editable && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:!bg-[#e2e3e8] hover:!text-foreground dark:hover:!bg-[#2c2c2c]"
                    onClick={() => onStartEdit?.()}
                    aria-label="编辑"
                  >
                    <PencilLine className="!size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">编辑</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:!bg-[#e2e3e8] hover:!text-foreground dark:hover:!bg-[#2c2c2c]"
                  onClick={handleCopy}
                  aria-label={copied ? '已复制' : '复制消息内容'}
                >
                  {copied ? <Check className="!size-3.5 text-green-500" /> : <Copy className="!size-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{copied ? '已复制' : '复制'}</TooltipContent>
            </Tooltip>
          </MessageFooter>
        )}

        {/* T07：actions 由 MessageFooter 承载，align="end" 时自动右对齐
            顺序 / 尺寸对齐 web 分析模式：复制 · 赞 · 踩 · 分享 · 重新生成（28px 钮 / 15px 图标） */}
        {isAssistant && !isStreaming && message.content && (
          <MessageFooter className="mt-1.5 gap-0.5 px-0 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:!bg-[#e2e3e8] hover:!text-foreground dark:hover:!bg-[#2c2c2c]"
                  onClick={handleCopy}
                  aria-label={copied ? '已复制' : '复制消息内容'}
                >
                  {copied ? <Check className="!size-[15px] text-green-500" /> : <Copy className="!size-[15px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{copied ? '已复制' : '复制'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:!bg-[#e2e3e8] hover:!text-foreground dark:hover:!bg-[#2c2c2c]"
                  onClick={() => toggleMessageFeedback(message.id, feedback === 'like' ? 'none' : 'like')}
                  aria-label={feedback === 'like' ? '取消赞' : '赞'}
                  aria-pressed={feedback === 'like'}
                >
                  <ThumbsUp className={cn('!size-[15px]', feedback === 'like' && 'text-[#3b82f6] dark:text-[#46a8f0]')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">赞</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:!bg-[#e2e3e8] hover:!text-foreground dark:hover:!bg-[#2c2c2c]"
                  onClick={() => toggleMessageFeedback(message.id, feedback === 'dislike' ? 'none' : 'dislike')}
                  aria-label={feedback === 'dislike' ? '取消踩' : '踩'}
                  aria-pressed={feedback === 'dislike'}
                >
                  <ThumbsDown className={cn('!size-[15px]', feedback === 'dislike' && 'text-[#3b82f6] dark:text-[#46a8f0]')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">踩</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:!bg-[#e2e3e8] hover:!text-foreground dark:hover:!bg-[#2c2c2c]"
                  onClick={handleShare}
                  aria-label={shared ? '内容已复制' : '分享此消息'}
                >
                  {shared ? <Check className="!size-[15px] text-green-500" /> : <Share className="!size-[15px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{shared ? '已复制' : '分享'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:!bg-[#e2e3e8] hover:!text-foreground dark:hover:!bg-[#2c2c2c]"
                  onClick={handleRegenerate}
                  aria-label="重新生成回复"
                >
                  <RotateCcw className="!size-[15px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">重新生成</TooltipContent>
            </Tooltip>
            {message.tokenUsage?.total && message.tokenUsage.total > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {message.tokenUsage.total} tokens
              </span>
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
})
