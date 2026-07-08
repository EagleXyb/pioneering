// ============================================================
// ComposerRuntimeStatus — 底部状态栏（对应文档 §13.2）
// 展示 Token 估算、图片数量、Agent 模式标识与字符上限提示。
// ============================================================

import { Zap, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComposerRuntimeStatusProps {
  tokens: number
  imageCount: number
  agentMode: boolean
  charCount: number
  charLimit: number
  className?: string
}

export function ComposerRuntimeStatus({
  tokens,
  imageCount,
  agentMode,
  charCount,
  charLimit,
  className
}: ComposerRuntimeStatusProps) {
  const isNearLimit = charCount > charLimit * 0.9
  const isOverLimit = charCount > charLimit

  return (
    <div className={cn('flex items-center gap-3 text-[11px] text-muted-foreground/60', className)}>
      {agentMode && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
          <Zap className="size-3" />
          Agent
        </span>
      )}
      {imageCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <ImageIcon className="size-3" />
          {imageCount}
        </span>
      )}
      <span className="tabular-nums">{tokens} tokens</span>
      {charCount > 0 && (
        <span
          className={cn(
            'tabular-nums transition-colors',
            isOverLimit ? 'text-destructive font-medium' : isNearLimit ? 'text-amber-500' : ''
          )}
        >
          {charCount}/{charLimit}
        </span>
      )}
    </div>
  )
}
