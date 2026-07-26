// ============================================================
// ComposerRuntimeStatus — 底部状态栏（对应文档 §13.2）
// 展示图片数量。
//
// T18：抽离硬编码视觉值到语义令牌（composer-status tokens），
// 与 Message 系列配色对齐。视觉表现与改造前完全一致，
// 仅将魔法值收口到 COMPOSER_STATUS_TOKENS 常量集中维护。
// ============================================================

import { ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * T18：Composer 状态栏视觉令牌。
 * 集中收口原本散落在 JSX 中的硬编码值，便于：
 *   1. 主题适配（未来切换主题时只改这一处）
 *   2. 与 Message 系列配色对齐（primary/muted-foreground 语义一致）
 *   3. 视觉规范审查（数值漂移检测）
 */
export const COMPOSER_STATUS_TOKENS = {
  /** 状态栏字号 — 11px，比正文小一档，避免抢焦 */
  fontSize: 'text-[11px]',
  /** 状态栏字色 — muted-foreground/50，比正文弱化 */
  textColor: 'text-muted-foreground/50',
  /** 图标尺寸 — size-2.5，与 11px 字号视觉平衡 */
  iconSize: 'size-2.5'
} as const

export interface ComposerRuntimeStatusProps {
  imageCount: number
  className?: string
}

export function ComposerRuntimeStatus({
  imageCount,
  className
}: ComposerRuntimeStatusProps) {
  return (
    <div className={cn('flex items-center gap-2', COMPOSER_STATUS_TOKENS.fontSize, COMPOSER_STATUS_TOKENS.textColor, className)}>
      {imageCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <ImageIcon className={COMPOSER_STATUS_TOKENS.iconSize} />
          <span className="tabular-nums">{imageCount}</span>
        </span>
      )}
    </div>
  )
}
