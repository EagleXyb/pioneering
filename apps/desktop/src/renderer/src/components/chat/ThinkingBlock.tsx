// ============================================================
// ThinkingBlock — WorkBuddy 风格的思考过程块
// 参照截图：
//   - 折叠态：可点击的 "深度思考 ›" 小标题
//   - 展开态：左侧 2px 灰色竖线引用样式，段落间以分隔线区分
// ============================================================

import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ThinkingBlockProps {
  content: string
  /** 是否仍在流式推理中；流式时显示光标动画 */
  isStreaming?: boolean
}

export function ThinkingBlock({ content, isStreaming = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(true)

  // 按空行拆分段落，过滤末尾因流式/分隔符产生的空段落，避免抖动
  const paragraphs = content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p, idx, arr) => p || idx !== arr.length - 1)

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-0.5 text-[12px] text-foreground/40 py-0.5 hover:text-foreground/60 transition-colors"
      >
        <span>深度思考</span>
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="relative pl-3 py-0.5">
            <div className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-border/70" />
            <div className="text-[12px] text-foreground/50 leading-relaxed break-words space-y-2">
              {paragraphs.map((para, idx) => (
                <p key={idx} className="whitespace-pre-wrap">{para}</p>
              ))}
              {isStreaming && (
                <span
                  className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-foreground/30 align-middle"
                  aria-hidden
                >
                  ▊
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
