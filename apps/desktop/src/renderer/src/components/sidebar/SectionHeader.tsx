// ============================================================
// SectionHeader — Sidebar 分组标题（任务/空间）
// ============================================================
// "标题 (数量)" + 下拉箭头（折叠 chevron-right / 展开 chevron-down）。
// 提取自 Sidebar.tsx。
// ============================================================

import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SectionHeaderProps {
  title: string
  count: number
  expanded: boolean
  onToggle: () => void
  placeholder?: boolean
}

/**
 * 分组标题行。点击切换展开/折叠态。
 */
export function SectionHeader({ title, count, expanded, onToggle, placeholder }: SectionHeaderProps) {
  return (
    <div
      onClick={onToggle}
      className={cn(
        'flex items-center justify-between h-[34px] px-3 gap-2 cursor-pointer select-none transition-colors rounded-[8px] hover:bg-accent/40',
        placeholder && 'opacity-60'
      )}
    >
      <span className="text-xs font-normal text-muted-foreground">
        {title} ({count})
      </span>
      {/* 折叠时显示 chevron-right，展开时显示 chevron-down */}
      {expanded ? (
        <ChevronDown
          className="size-4 text-muted-foreground/60 shrink-0"
          strokeWidth={1.5}
        />
      ) : (
        <ChevronRight
          className="size-4 text-muted-foreground/60 shrink-0"
          strokeWidth={1.5}
        />
      )}
    </div>
  )
}
