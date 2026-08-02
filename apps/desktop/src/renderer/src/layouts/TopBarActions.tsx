// ============================================================
// TopBarActions — 覆盖模式（小屏抽屉）的顶部操作条
// ============================================================
// 仅 Win/Linux 使用（macOS 由 MacTitleBar 承担）。
// 当侧边栏折叠时显示：展开侧边栏 / 新建任务 / 展开右面板。
// 提取自 RootLayout.tsx。
// ============================================================

import { useAtom } from 'jotai'
import { PanelLeft, Plus, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from '@/components/ui/tooltip'
import type { Platform } from '@shared/types'
import { formatAccelerator } from '@/menu/formatAccelerator'
import { contextPanelVisibleAtom } from '@/stores/atoms'

export interface TopBarActionsProps {
  platform: Platform
  onExpandSidebar: () => void
  onCreate: () => void | Promise<void>
}

/**
 * 覆盖模式顶部操作条。仅 Win/Linux 且侧边栏折叠时渲染。
 */
export function TopBarActions({ platform, onExpandSidebar, onCreate }: TopBarActionsProps) {
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onExpandSidebar}>
              <PanelLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" className="text-xs">
            展开侧边栏
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCreate}>
              <Plus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" className="text-xs gap-1.5 flex items-center">
            <span>新建任务</span>
            <kbd className="rounded border border-primary-foreground/20 bg-primary-foreground/10 px-1.5 py-0.5 text-[10px] font-mono">
              {formatAccelerator('CmdOrCtrl+N', platform)}
            </kbd>
          </TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        {!contextPanelVisible && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setContextPanelVisible(true)}
              >
                <PanelRight className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="text-xs">
              展开右侧面板
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}
