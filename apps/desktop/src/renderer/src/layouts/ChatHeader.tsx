// ============================================================
// ChatHeader — 中栏会话顶部栏
// ============================================================
// 内容区贴边无沟渠，按钮在 48px 标题栏内垂直居中；
// 左栏 MacTitleBar 的按钮在同一 48px 高度内居中对齐。
//
// 职责：
//   - 显示会话标题
//   - 侧边栏折叠时左侧显示「展开侧边栏 / 新建任务」入口（macOS 留红绿灯避让）
//   - 右侧显示分享 / 展开右面板入口
//   - 消息区滚动离开顶部时显示下边框（chatScrolledAtom）
//
// T12（修复任务清单 T12 / 报告 §2.3）：
//   - 「分享」接通 chatStore.shareSession：云端会话复制 shareUrl，
//     本地会话（后端无分享端点）明确提示而非静默返回 null；
//   - 「在会话中搜索」「历史记录」为无 onClick 死按钮，已移除
//     （会话内查找复用消息列表、历史即左侧会话列表，待独立能力排期后再加回）。
// ============================================================

import { useState } from 'react'
import { useAtomValue } from 'jotai'
import {
  PanelLeft,
  SquarePen,
  PanelRight,
  Share2,
  Check
} from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { chatScrolledAtom } from '@/stores/atoms'
import { useChatStore } from '@/stores/chatStore'
import { clipboardApi, notificationApi } from '@/services/ipc'
import { HeaderButton } from './HeaderButton'

export interface ChatHeaderProps {
  title: string
  contextPanelVisible: boolean
  sidebarVisible: boolean
  onToggleContext: () => void
  onToggleSidebar: () => void
  onCreate: () => void | Promise<void>
  /** 是否显示会话专用按钮（分享/展开右面板）；非会话功能页传 false */
  showSessionActions?: boolean
}

/**
 * 中栏顶部栏。
 *
 * 两种模式：
 *   - 会话视图（showSessionActions=true，默认）：显示会话标题 + 右侧分享/展开右面板
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
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const shareSession = useChatStore((s) => s.shareSession)
  const [copied, setCopied] = useState(false)

  // T12：与 SessionActionsDropdown 的分享逻辑同口径——
  // 云端有 shareUrl 复制链接；本地会话后端直接 return null，降级复制会话信息前，
  // 先给出明确提示，避免用户误以为拿到了可公开访问的链接。
  const handleShare = async () => {
    if (!currentSessionId) return
    const session = useChatStore
      .getState()
      .sessions.find((s) => s.id === currentSessionId)
    const url = await shareSession(currentSessionId)
    if (url) {
      await clipboardApi.write(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
      return
    }
    if (session?.runtime === 'local') {
      notificationApi.show({
        title: '本地会话暂不支持在线分享',
        body: '本地会话仅保存在本机；云端会话可生成分享链接。'
      })
      return
    }
    // 云端后端暂不可用：降级复制会话信息（与会话行「⋯」菜单一致）
    await clipboardApi.write(`${session?.title || '会话'}\nSession ID: ${currentSessionId}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

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
            <HeaderButton icon={SquarePen} title="新建任务" onClick={onCreate} />
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
            {/* T12：分享真实接线（图标态反馈「已复制」2s）；搜索/历史死按钮已移除 */}
            <HeaderButton
              icon={copied ? Check : Share2}
              title={copied ? '分享链接已复制' : '分享'}
              onClick={() => void handleShare()}
            />
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
