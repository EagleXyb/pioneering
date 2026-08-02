// ============================================================
// HeaderButton — ChatHeader / TopBarActions 共用的图标按钮
// ============================================================
// Tooltip 包裹的 ghost 按钮，统一中栏顶部栏与覆盖模式操作条的图标按钮样式。
// 提取自 RootLayout.tsx，供 ChatHeader 与 TopBarActions 复用。
// ============================================================

import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent
} from '@/components/ui/tooltip'

export interface HeaderButtonProps {
  icon: LucideIcon
  onClick?: () => void
  title: string
  /** Tooltip 对齐，默认 center */
  align?: 'center' | 'start' | 'end'
}

/**
 * 中栏顶部栏图标按钮：ghost + h-8 w-8 + 18px 图标。
 * Tooltip 默认下方居中显示。
 */
export function HeaderButton({ icon: Icon, onClick, title, align = 'center' }: HeaderButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 rounded-md"
          onClick={onClick}
        >
          <Icon size={18} strokeWidth={1.5} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align={align} className="text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  )
}
