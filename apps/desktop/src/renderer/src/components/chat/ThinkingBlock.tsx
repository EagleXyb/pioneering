// ============================================================
// ThinkingBlock — WorkBuddy 风格的思考过程块
// 参照截图："深度思考"为灰色小标题（无图标/箭头），内容默认展开，
// 左侧带 2px 灰色竖线引用样式
// ============================================================

interface ThinkingBlockProps {
  content: string
  /** 是否仍在流式推理中；流式时显示光标动画 */
  isStreaming?: boolean
}

export function ThinkingBlock({ content, isStreaming = false }: ThinkingBlockProps) {
  return (
    <div className="mb-0.5">
      <div className="text-[12px] text-foreground/40 py-0.5">深度思考</div>
      <div className="relative pl-3">
        <div className="absolute left-0 top-0.5 bottom-0.5 w-[2px] rounded-full bg-border/70" />
        <div className="text-[12px] text-foreground/55 leading-relaxed whitespace-pre-wrap break-words">
          {content}
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
  )
}
