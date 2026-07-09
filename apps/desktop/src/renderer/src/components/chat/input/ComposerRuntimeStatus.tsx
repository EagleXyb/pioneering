// ============================================================
// ComposerRuntimeStatus — 底部状态栏（对应文档 §13.2）
// 展示图片数量与 Agent 模式标识。
// ============================================================

import { Zap, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComposerRuntimeStatusProps {
  imageCount: number
  agentMode: boolean
  className?: string
}

export function ComposerRuntimeStatus({
  imageCount,
  agentMode,
  className
}: ComposerRuntimeStatusProps) {
  return (
    <div className={cn('flex items-center gap-2 text-[11px] text-muted-foreground/50', className)}>
      {agentMode && (
        <span className="inline-flex items-center gap-1 rounded bg-primary/8 px-1.5 py-0.5 text-primary">
          <Zap className="size-2.5" />
          <span>Agent</span>
        </span>
      )}
      {imageCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <ImageIcon className="size-2.5" />
          <span className="tabular-nums">{imageCount}</span>
        </span>
      )}
    </div>
  )
}
