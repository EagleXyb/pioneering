// ============================================================
// ThinkingBlock — 深度思考折叠块（扁平路径）
// 对齐 apps/web/src/components/message/ReasoningBlock.tsx：
//   - 标题「深度思考」+ 箭头：流式期间标题呼吸提示并自动展开，
//     本段结束后自动收起；用户点击后以手动状态为准
//   - 展开后为轻引用排版（左侧 4px 竖线 + 深灰正文；内容区最大
//     高度 188px，超出部分内部滚动，滚动不带动外层消息列表）
//   - 内容经 MarkdownRenderer 渲染（替代原纯文本分段），与正文
//     回复共享同一渲染管线（安全 sanitize / 代码块 / 链接白名单）
//   - 流式期间自动跟随最新内容滚动到底部
// ============================================================

import { memo, useEffect, useRef, useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarkdownRenderer } from './MarkdownRenderer'

interface ThinkingBlockProps {
  content: string
  /** 是否仍在流式推理中 */
  isStreaming?: boolean
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  isStreaming = false
}: ThinkingBlockProps) {
  // 流式期间展开、终态收起；用户点击后以手动状态为准
  const [open, setOpen] = useState(isStreaming)
  const prevStreamingRef = useRef(isStreaming)

  useEffect(() => {
    const prev = prevStreamingRef.current
    prevStreamingRef.current = isStreaming
    if (prev && !isStreaming) setOpen(false)
  }, [isStreaming])

  // 流式期间自动跟随最新内容（思考区限高内部滚动）
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !isStreaming) return
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [content, open, isStreaming])

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg py-1 pl-0.5 pr-2 -ml-0.5',
          'text-[1rem] leading-6 text-muted-foreground select-none',
          'transition-colors hover:text-foreground hover:bg-accent'
        )}
      >
        <Brain className="size-3.5 shrink-0" aria-hidden />
        <span className={cn(isStreaming && 'animate-pulse')}>深度思考</span>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
      </button>

      {/* 展开/折叠容器：grid 0fr→1fr 高度过渡 + 淡入下滑（双向平滑） */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out',
          open
            ? 'grid-rows-[1fr] opacity-100 translate-y-0'
            : 'grid-rows-[0fr] opacity-0 -translate-y-[3px]'
        )}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="overflow-hidden min-h-0">
          {/* 引用式内容块：左侧 4px 竖线（对齐 web tao-reasoning-body），
              内容区限高 188px（标题行 ~32px + 内容 = 整块 220px 上限），
              超出内部滚动且 overscroll-behavior: contain 不带动外层列表 */}
          <div
            ref={bodyRef}
            className={cn(
              'ml-0.5 border-l-4 border-border pl-4 pr-2 py-0.5',
              'max-h-[188px] overflow-y-auto overscroll-contain',
              'text-[1rem] leading-[1.75] text-muted-foreground break-words',
              // Markdown 排版随思考正文降一档：正文灰、标题/加粗回到前景色（web 降噪规范）
              '[&_.chat-markdown]:text-[1rem] [&_.chat-markdown]:leading-[1.75] [&_.chat-markdown]:text-muted-foreground',
              '[&_.chat-markdown_:is(h1,h2,h3,h4,strong)]:text-foreground'
            )}
          >
            <MarkdownRenderer content={content} />
          </div>
        </div>
      </div>
    </div>
  )
})
