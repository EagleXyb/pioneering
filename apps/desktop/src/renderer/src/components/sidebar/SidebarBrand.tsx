// ============================================================
// SidebarBrand — Sidebar 顶部品牌栏（仅 Win/Linux）
// ============================================================
// macOS 下工具栏按钮在标题栏，品牌栏整体隐藏。
// Win/Linux 显示搜索/筛选/侧边栏切换三个图标按钮。
// 提取自 Sidebar.tsx。
// ============================================================

import { useAtom } from 'jotai'
import { Search, SlidersHorizontal, PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent
} from '@/components/ui/tooltip'
import { sidebarVisibleAtom } from '@/stores/atoms'

export interface SidebarBrandProps {
  /** 当前侧边栏可见态（用于 tooltip 文案） */
  sidebarVisible: boolean
  onToggleSidebar: () => void
}

/**
 * Win/Linux 品牌栏：搜索 / 筛选 / 侧边栏切换。
 */
export function SidebarBrand({ sidebarVisible, onToggleSidebar }: SidebarBrandProps) {
  const [, setSidebarVisible] = useAtom(sidebarVisibleAtom)

  return (
    <div className="conversation-list-header px-3 pt-0 pb-0 shrink-0">
      <div className="flex items-center justify-end py-1">
        {/* 右侧：搜索/筛选/侧边栏切换 */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => {}}
              >
                <Search className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" className="text-xs">
              搜索（即将开放）
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => {}}
              >
                <SlidersHorizontal className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" className="text-xs">
              筛选（即将开放）
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onToggleSidebar}
              >
                <PanelLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" className="text-xs">
              {sidebarVisible ? '收起侧边栏' : '展开侧边栏'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
