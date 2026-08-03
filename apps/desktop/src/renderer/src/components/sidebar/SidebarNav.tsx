// ============================================================
// SidebarNav — Sidebar 功能按钮区（新建任务 + 导航项）
// ============================================================
// 包含 NAV_ITEMS 配置与导航项渲染逻辑。
// 主操作按钮「新建任务」+ 助理/技能/插件/自动化/更多 导航项。
// 提取自 Sidebar.tsx。
// ============================================================

import {
  Sparkles,
  FolderOpen,
  GraduationCap,
  Zap,
  Ellipsis,
  MessageCirclePlus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface NavItem {
  key: string
  label: string
  icon: typeof Sparkles
  route: string
  placeholder: boolean
  extra?: string
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'assistant', label: '助理', icon: Sparkles, route: '/assistant', placeholder: false },
  { key: 'skills', label: '技能', icon: FolderOpen, route: '/skills', placeholder: true },
  {
    key: 'plugins',
    label: '插件',
    icon: GraduationCap,
    route: '/plugins',
    placeholder: true
  },
  { key: 'automation', label: '自动化', icon: Zap, route: '/automation', placeholder: true },
  {
    key: 'more',
    label: '更多',
    icon: Ellipsis,
    route: '/more',
    placeholder: true,
    extra: '知识库'
  }
]

export interface SidebarNavProps {
  activeNavKey: string
  onCreate: () => void | Promise<void>
  onNavClick: (item: NavItem) => void
}

/**
 * 功能按钮区：新建任务主按钮 + 导航项列表。
 * 容器 px-3 统一 12px 左右边距；所有项圆角统一 rounded-[8px]，垂直间距统一 mb-1。
 */
export function SidebarNav({ activeNavKey, onCreate, onNavClick }: SidebarNavProps) {
  return (
    <div className="px-3 pb-1 shrink-0 pt-[18px]">
      {/* ---- 主按钮：新建任务（默认透明，hover 浅灰，激活态实色块） ---- */}
      <Button
        variant="ghost"
        className={cn(
          'w-full h-[32px] px-3 gap-2 justify-start rounded-[8px] text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5 shadow-none mb-1 font-normal [&_svg]:size-4',
          activeNavKey === 'new-task' &&
            'bg-black/10 text-foreground font-medium hover:bg-black/10 dark:bg-white/10'
        )}
        onClick={onCreate}
      >
        <MessageCirclePlus className="shrink-0" strokeWidth={1.5} />
        <span className="text-sm font-normal">新建任务</span>
      </Button>

      {/* ---- 导航项 ---- */}
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const isActive = activeNavKey === item.key
        return (
          <div
            key={item.key}
            onClick={() => onNavClick(item)}
            className={cn(
              'flex items-center justify-between h-[32px] px-3 gap-2 rounded-[8px] cursor-pointer select-none transition-colors mb-1',
              isActive
                ? 'bg-black/10 text-foreground font-medium dark:bg-white/10'
                : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5'
            )}
          >
            <div className="flex items-center gap-2">
              <Icon className="size-4 shrink-0" strokeWidth={1.5} />
              <span className="text-sm font-normal">{item.label}</span>
            </div>
            {'extra' in item && item.extra && (
              <span className="text-xs text-muted-foreground/70 font-normal">
                {item.extra}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
