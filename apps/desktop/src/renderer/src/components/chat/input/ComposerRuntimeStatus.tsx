// ============================================================
// ComposerRuntimeStatus — 底部状态栏（对应文档 §13.2）
// 展示图片数量与 Agent 模式标识。
//
// T18：抽离硬编码视觉值到语义令牌（composer-status tokens），
// 与 Message 系列配色对齐。视觉表现与改造前完全一致，
// 仅将魔法值收口到 COMPOSER_STATUS_TOKENS 常量集中维护。
// ============================================================

import { Zap, ImageIcon } from 'lucide-react'
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
  /** Agent 徽标背景 — primary/8（8% 透明度），与 Message Footer 一致 */
  agentBadgeBg: 'bg-primary/8',
  /** Agent 徽标字色 — primary，强语义 */
  agentBadgeText: 'text-primary',
  /** Agent 徽标圆角 — rounded，与 Button size=icon-xs 一致 */
  agentBadgeRadius: 'rounded',
  /** Agent 徽标内边距 — px-1.5 py-0.5，紧凑 */
  agentBadgePadding: 'px-1.5 py-0.5',
  /** 图标尺寸 — size-2.5，与 11px 字号视觉平衡 */
  iconSize: 'size-2.5'
} as const

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
    <div className={cn('flex items-center gap-2', COMPOSER_STATUS_TOKENS.fontSize, COMPOSER_STATUS_TOKENS.textColor, className)}>
      {agentMode && (
        <span
          className={cn(
            'inline-flex items-center gap-1',
            COMPOSER_STATUS_TOKENS.agentBadgeRadius,
            COMPOSER_STATUS_TOKENS.agentBadgePadding,
            COMPOSER_STATUS_TOKENS.agentBadgeBg,
            COMPOSER_STATUS_TOKENS.agentBadgeText
          )}
        >
          <Zap className={COMPOSER_STATUS_TOKENS.iconSize} />
          <span>Agent</span>
        </span>
      )}
      {imageCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <ImageIcon className={COMPOSER_STATUS_TOKENS.iconSize} />
          <span className="tabular-nums">{imageCount}</span>
        </span>
      )}
    </div>
  )
}
