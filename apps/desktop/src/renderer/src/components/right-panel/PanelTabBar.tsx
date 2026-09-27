// ============================================================
// PanelTabBar — 右侧面板标签栏
// ============================================================
// 布局对齐参考图：
//   [菜单]  标签A  标签B  [+]  ──────  [最大化] [收起]
//
// 标签样式：激活态为浅灰圆角块（图标 + 标题截断 + 关闭），
// 非激活态透明、hover 浅灰；关闭按钮默认隐藏，hover / 激活时显现。
// 标签过多时列表区横向滚动，右侧操作区固定不被挤压。
// ============================================================

import type { LucideIcon } from 'lucide-react'
import {
  FileCode2,
  Kanban,
  List,
  Maximize2,
  Menu,
  Minimize2,
  PanelRight,
  Plus,
  X
} from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  TASK_TABS,
  activateTabAtom,
  closeTabAtom,
  collapseRightPanelAtom,
  openTabAtom,
  rightPanelActiveTabIdAtom,
  rightPanelMaximizedAtom,
  rightPanelTabsAtom,
  type RightPanelTab,
  type RightPanelTabKind
} from '@/stores/rightPanelStore'

/** 标签种类 → 图标 */
const TAB_ICON: Record<RightPanelTabKind, LucideIcon> = {
  monitor: List,
  pipeline: Kanban,
  preview: FileCode2
}

/** 标签栏图标按钮（h-7 与标签同高） */
function BarButton({
  icon: Icon,
  title,
  onClick,
  active
}: {
  icon: LucideIcon
  title: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-7 w-7 shrink-0 rounded-md transition-colors',
            active
              ? 'bg-black/[0.07] text-foreground dark:bg-white/[0.12]'
              : 'text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10'
          )}
          onClick={onClick}
          aria-label={title}
        >
          <Icon size={16} strokeWidth={1.5} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

/** 单个标签 */
function TabItem({ tab, active }: { tab: RightPanelTab; active: boolean }) {
  const activateTab = useSetAtom(activateTabAtom)
  const closeTab = useSetAtom(closeTabAtom)
  const Icon = TAB_ICON[tab.kind]

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={tab.title}
      onClick={() => activateTab(tab.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          activateTab(tab.id)
        }
      }}
      className={cn(
        'group flex h-7 max-w-[180px] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-lg pl-2 pr-1 transition-colors',
        active
          ? 'bg-black/[0.07] text-foreground dark:bg-white/[0.12]'
          : 'text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]'
      )}
    >
      <Icon size={14} strokeWidth={1.75} className="shrink-0" />
      <span className="truncate text-[13px] leading-none">{tab.title}</span>
      {tab.closable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            closeTab(tab.id)
          }}
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded transition-all',
            active
              ? 'opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15'
              : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-black/10 dark:hover:bg-white/10'
          )}
          aria-label={`关闭 ${tab.title}`}
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

/** 「新建标签」菜单项（菜单按钮与 + 按钮共用同一份内容） */
function NewTabItems() {
  const openTab = useSetAtom(openTabAtom)
  return (
    <>
      <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
        新建标签
      </DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => openTab(TASK_TABS.monitor)}>
        <List size={14} />
        任务监控
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => openTab(TASK_TABS.pipeline)}>
        <Kanban size={14} />
        任务流水线
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {/* 扩展位：接入「本地文件」「网页」标签时替换为可用项
          （前者需新增 fs:readDir 通道，后者需主进程 WebContentsView） */}
      <DropdownMenuItem disabled>打开本地文件（即将上线）</DropdownMenuItem>
      <DropdownMenuItem disabled>打开网页（即将上线）</DropdownMenuItem>
    </>
  )
}

export function PanelTabBar() {
  const tabs = useAtomValue(rightPanelTabsAtom)
  const activeId = useAtomValue(rightPanelActiveTabIdAtom)
  const maximized = useAtomValue(rightPanelMaximizedAtom)
  const setMaximized = useSetAtom(rightPanelMaximizedAtom)
  const collapse = useSetAtom(collapseRightPanelAtom)

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-[var(--titlebar-h)] shrink-0 items-center gap-1 border-b border-border px-2">
        {/* 面板菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-md text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              aria-label="面板菜单"
            >
              <Menu size={16} strokeWidth={1.5} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <NewTabItems />
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 标签列表（横向滚动，隐藏滚动条） */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => (
            <TabItem key={tab.id} tab={tab} active={tab.id === activeId} />
          ))}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-md text-foreground/60 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                aria-label="新建标签"
              >
                <Plus size={16} strokeWidth={1.5} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <NewTabItems />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* 右侧固定操作区 */}
        <BarButton
          icon={maximized ? Minimize2 : Maximize2}
          title={maximized ? '还原面板宽度' : '最大化面板'}
          active={maximized}
          onClick={() => setMaximized(!maximized)}
        />
        <BarButton icon={PanelRight} title="收起右侧面板" onClick={collapse} />
      </div>
    </TooltipProvider>
  )
}
