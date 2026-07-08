// ============================================================
// ContextRing — 上下文压缩环（对应文档 §14）
// 展示上下文压缩状态并提供手动触发入口。状态有：
// idle / compressing / compressed / skipped / blocked / failed。
// 本项目后端暂未实现压缩，故以视觉反馈为主，onCompress 可选。
// ============================================================

import { Loader2, Check, AlertTriangle, Ban, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ContextCompressionStatus =
  | 'idle'
  | 'compressing'
  | 'compressed'
  | 'skipped'
  | 'blocked'
  | 'failed'

export interface ContextRingProps {
  status?: ContextCompressionStatus
  onCompress?: () => void
  disabled?: boolean
  className?: string
}

const STATUS_META: Record<
  ContextCompressionStatus,
  { icon: typeof Loader2; color: string; spin?: boolean; title: string }
> = {
  idle: { icon: Minimize2, color: 'text-muted-foreground/60', title: '压缩上下文' },
  compressing: { icon: Loader2, color: 'text-primary', spin: true, title: '压缩中…' },
  compressed: { icon: Check, color: 'text-green-500', title: '已压缩' },
  skipped: { icon: Minimize2, color: 'text-muted-foreground/50', title: '已跳过' },
  blocked: { icon: Ban, color: 'text-muted-foreground/40', title: '不可压缩' },
  failed: { icon: AlertTriangle, color: 'text-destructive', title: '压缩失败' }
}

export function ContextRing({
  status = 'idle',
  onCompress,
  disabled,
  className
}: ContextRingProps) {
  const meta = STATUS_META[status]
  const Icon = meta.icon

  return (
    <button
      type="button"
      disabled={disabled || !onCompress}
      onClick={onCompress}
      title={meta.title}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
        'hover:bg-accent/50 disabled:opacity-30',
        meta.color
      )}
    >
      <Icon className={cn('size-4', meta.spin && 'animate-spin')} />
    </button>
  )
}
