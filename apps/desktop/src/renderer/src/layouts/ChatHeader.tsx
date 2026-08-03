// ============================================================
// ChatHeader — 中栏会话顶部栏
// ============================================================
// 卡片有 5px top 沟渠，按钮自然位于 Y=29px；
// 左栏 MacTitleBar 的按钮也使用 pt-[5px] 下移对齐。
//
// 职责：
//   - 显示会话标题
//   - 侧边栏折叠时左侧显示「展开侧边栏 / 新建任务」入口（macOS 留红绿灯避让）
//   - 右侧显示搜索 / 分享 / 历史 / 展开右面板入口
//   - 消息区滚动离开顶部时显示下边框（chatScrolledAtom）
// ============================================================

import { useAtomValue } from 'jotai'
import {
  PanelLeft,
  MessageCirclePlus,
  PanelRight,
  Search,
  Share2,
  History
} from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { chatScrolledAtom } from '@/stores/atoms'
import { HeaderButton } from './HeaderButton'

export interface ChatHeaderProps {
  title: string
  contextPanelVisible: boolean
  sidebarVisible: boolean
  onToggleContext: () => void
  onToggleSidebar: () => void
  onCreate: () => void | Promise<void>
  /** 是否显示会话专用按钮（搜索/分享/历史/展开右面板）；非会话功能页传 false */
  showSessionActions?: boolean
}

/**
 * 中栏顶部栏。
 *
 * 两种模式：
 *   - 会话视图（showSessionActions=true，默认）：显示会话标题 + 右侧搜索/分享/历史/展开右面板
 *   - 功能页视图（showSessionActions=false）：仅显示对应功能页标题，无会话专用操作
 *
 * 消息区滚动离开顶部时显示下边框；在顶部/无滚动内容时隐藏
 * （始终保留 border-b 的 1px 空间并仅切换颜色，避免边框显隐引起 1px 布局抖动）。
 */
export function ChatHeader({
  title,
  contextPanelVisible,
  sidebarVisible,
  onToggleContext,
  onToggleSidebar,
  onCreate,
  showSessionActions = true
}: ChatHeaderProps) {
  const isChatScrolled = useAtomValue(chatScrolledAtom)

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          'flex items-center h-[var(--titlebar-h)] shrink-0 px-4 select-none border-b border-transparent',
          isChatScrolled && 'border-border/50'
        )}
      >
        {/* 侧边栏折叠时：展开侧边栏 + 新建任务（三平台统一入口）；
            macOS 下左侧留出红绿灯避让区（--traffic-light-w）避免重叠 */}
        {!sidebarVisible && (
          <div
            className="flex items-center gap-1 mr-3"
            style={{ paddingLeft: 'var(--traffic-light-w)' }}
          >
            <HeaderButton icon={PanelLeft} title="展开侧边栏" onClick={onToggleSidebar} />
            <HeaderButton icon={MessageCirclePlus} title="新建任务" onClick={onCreate} />
          </div>
        )}
        {/* 会话标题：展开状态下左侧留 9px 边距（16px 容器内边距 + 9px ≈ 25px 距卡片左缘） */}
        <span
          className={cn(
            'text-[16px] font-semibold text-foreground truncate',
            sidebarVisible && 'ml-[9px]'
          )}
        >
          {title}
        </span>
        <div className="flex-1" />
        {showSessionActions && (
          <div className="flex items-center gap-1">
            <HeaderButton icon={Search} title="在会话中搜索" />
            <HeaderButton icon={Share2} title="分享" />
            <HeaderButton icon={History} title="历史记录" />
            {/* 右侧面板展开时不显示收起入口，折叠时显示展开入口 */}
            {!contextPanelVisible && (
              <HeaderButton
                icon={PanelRight}
                title="展开右侧面板"
                onClick={onToggleContext}
              />
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
