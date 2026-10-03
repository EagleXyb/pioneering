// ============================================================
// MacTitleBar — macOS 专用标题栏（WorkBuddy 风格）
//
// 展开状态（sidebarVisible = true）：
//   [──灰侧栏(262px)──]
//   灰色区：红绿灯避让 + toggle/搜索/筛选按钮
//   右侧不渲染占位元素，让中栏 ChatHeader / 右栏 RightPanel 标签栏
//          直接在白色卡片内自然显示，不被 TitleBar 覆盖
//
// 折叠状态（sidebarVisible = false）：
//   [红绿灯避让]
//   仅保留红绿灯避让区；展开侧边栏/新建入口由中栏 ChatHeader 左侧按钮提供（三平台一致）
//
// 注意：TitleBar 在 macOS 下不设全宽（无 inset-x-0 / right-0），
//       只覆盖左侧必要区域；右侧内容由下方卡片的 header 自然填充。
// ============================================================

import { memo } from 'react'
import {
  Search,
  Filter,
  PanelLeft
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
  onDragMouseDown?: (e: React.MouseEvent) => void
}

// 与 RootLayout 的 SIDEBAR_WIDTH 保持一致（WorkBuddy / DeepSeek / 千问办公基准 262px）
const SIDEBAR_WIDTH = 262

function ToolbarButton({
  icon: Icon,
  onClick,
  title,
  size = 20
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
          className="h-10 w-10 rounded-xl text-foreground/70 hover:text-foreground hover:bg-black/[0.06] dark:hover:bg-white/10"
          onClick={onClick}
        >
          <Icon size={size} strokeWidth={2} />
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
  onDragMouseDown
}: MacTitleBarProps) {
  const tlw = isFullscreen ? 0 : 72

  return (
    <TooltipProvider delayDuration={200}>
      {sidebarVisible ? (
        /* 展开状态：左侧灰色区（侧栏宽 262px），不渲染右侧占位；与内容区无分割线 */
        <div
          className="flex items-center h-full bg-sidebar relative z-30 pointer-events-auto"
          style={{ width: SIDEBAR_WIDTH }}
          onMouseDown={onDragMouseDown}
        >
          {!isFullscreen && <div className="shrink-0" style={{ width: tlw }} />}
          <div className="flex-1" />
          {/* 按钮组在 48px 标题栏内垂直居中，与右侧贴顶白卡的 ChatHeader 按钮对齐。
              图标 26px 置于 40px 按钮内两侧各留 7px，用 -space-x-1 收紧笔画间距，
              悬停热区仍为完整 40×40（相邻按钮仅 4px 重叠，不会同时悬停）。 */}
          <div className="flex items-center -space-x-1 pr-3">
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
        /* 折叠状态：仅保留红绿灯避让区；
           展开侧边栏/新建入口统一由中栏 ChatHeader 左侧按钮提供（三平台一致），
           避免与 ChatHeader 按钮重叠 */
        <div
          className="flex items-center h-full relative z-30 pointer-events-auto"
          onMouseDown={onDragMouseDown}
        >
          {!isFullscreen && <div className="shrink-0 h-full" style={{ width: tlw }} />}
        </div>
      )}
    </TooltipProvider>
  )
})
