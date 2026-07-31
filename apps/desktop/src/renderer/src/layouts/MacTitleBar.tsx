// ============================================================
// MacTitleBar — macOS 专用标题栏（WorkBuddy 风格）
//
// 展开状态（sidebarVisible = true）：
//   [──灰侧栏(262px)──]
//   灰色区：红绿灯避让 + toggle/搜索/筛选按钮
//   右侧不渲染占位元素，让中栏 ChatHeader / 右栏 ContextPanel header
//          直接在白色卡片内自然显示，不被 TitleBar 覆盖
//
// 折叠状态（sidebarVisible = false）：
//   [红绿灯避让] [toggle][💬+]
//   按钮区宽度自适应内容
//
// 注意：TitleBar 在 macOS 下不设全宽（无 inset-x-0 / right-0），
//       只覆盖左侧必要区域；右侧内容由下方卡片的 header 自然填充。
// ============================================================

import { memo } from 'react'
import {
  Search,
  Filter,
  PanelLeft,
  MessageSquarePlus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from '@/components/ui/tooltip'
import type { LucideIcon } from 'lucide-react'

interface MacTitleBarProps {
  sidebarVisible: boolean
  isFullscreen: boolean
  onToggleSidebar: () => void
  onCreate: () => void | Promise<void>
}

const SIDEBAR_WIDTH = 262

function ToolbarButton({
  icon: Icon,
  onClick,
  title,
  size = 18
}: {
  icon: LucideIcon
  onClick?: () => void
  title: string
  size?: number
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 rounded-md"
          onClick={onClick}
        >
          <Icon size={size} strokeWidth={1.5} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" className="text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

export const MacTitleBar = memo(function MacTitleBar({
  sidebarVisible,
  isFullscreen,
  onToggleSidebar,
  onCreate
}: MacTitleBarProps) {
  const tlw = isFullscreen ? 0 : 72

  return sidebarVisible ? (
    /* 展开状态：左侧灰色区（侧栏宽 262px），不渲染右侧占位 */
    <div
      className="flex items-center h-full bg-sidebar relative z-30 pointer-events-auto"
      style={{ width: SIDEBAR_WIDTH }}
    >
      {!isFullscreen && <div className="shrink-0" style={{ width: tlw }} />}
      <div className="flex-1" />
      <div className="flex items-center gap-0.5 pr-2">
        <ToolbarButton
          icon={PanelLeft}
          onClick={onToggleSidebar}
          title="收起侧边栏"
        />
        <ToolbarButton icon={Search} title="搜索（即将开放）" />
        <ToolbarButton icon={Filter} title="筛选（即将开放）" />
      </div>
    </div>
  ) : (
    /* 折叠状态：红绿灯避让 + 操作按钮，宽度自适应 */
    <div className="flex items-center h-full relative z-30 pointer-events-auto">
      {!isFullscreen && <div className="shrink-0 h-full" style={{ width: tlw }} />}
      <div className="flex items-center gap-0.5 pl-0.5">
        <ToolbarButton
          icon={PanelLeft}
          onClick={onToggleSidebar}
          title="展开侧边栏"
        />
        <ToolbarButton
          icon={MessageSquarePlus}
          onClick={onCreate}
          title="新建对话"
          size={20}
        />
      </div>
    </div>
  )
})
