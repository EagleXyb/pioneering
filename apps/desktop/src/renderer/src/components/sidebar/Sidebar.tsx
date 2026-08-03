// ============================================================
// Sidebar — 左栏容器（品牌栏 + 导航 + 任务/空间分组 + 账户）
// ============================================================
// 子组件外提（问题 3 收敛）：
//   - SidebarBrand（Win/Linux 品牌栏）→ SidebarBrand.tsx
//   - SidebarNav（新建任务 + 导航项）→ SidebarNav.tsx（含 NAV_ITEMS）
//   - SectionHeader（分组标题）→ SectionHeader.tsx
//   - AccountMenu（底部账户下拉）→ AccountMenu.tsx
// 本文件仅保留容器编排与状态管理逻辑。
// ============================================================

import { memo, useCallback, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useNavigate, useLocation } from 'react-router-dom'
import { sidebarVisibleAtom } from '@/stores/atoms'
import { authViewAtom } from '@/stores/authStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ConversationList } from './ConversationList'
import { SidebarBrand } from './SidebarBrand'
import { SidebarNav, NAV_ITEMS, type NavItem } from './SidebarNav'
import { SectionHeader } from './SectionHeader'
import { AccountMenu } from './AccountMenu'
import { useChatStore } from '../../stores/chatStore'
import { usePlatform } from '@/hooks/usePlatform'

export const Sidebar = memo(function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const { isMac } = usePlatform()

  // 认证态统一来自 authStore：Sidebar 不再自行判断登录态或拉取资料，
  // 从根本上消除「effect 抢跑 token 恢复」的竞态。
  const { user, isAuthed, isSettling, isError } = useAtomValue(authViewAtom)

  // 会话数据（用于计数、新建、计算选中映射）
  const sessionsCount = useChatStore((s) => s.sessions.length)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const currentSession = useChatStore((s) =>
    s.currentSessionId ? s.sessions.find((x) => x.id === s.currentSessionId) ?? null : null
  )
  const isDraftNewSession = useChatStore((s) => s.isDraftNewSession)
  const startNewTask = useChatStore((s) => s.startNewTask)

  // 分组折叠状态
  const [tasksExpanded, setTasksExpanded] = useState(true)
  const [spacesExpanded, setSpacesExpanded] = useState(true)

  // ============================================================
  // 导航激活态判定（路由 + 会话状态推导，保证"恰好一个高亮"）：
  //
  //  原则：导航项高亮 = 当前视图位于对应功能页或新建任务 draft 态；
  //       会话行高亮 = 当前选中了具体会话 AND 路由处于会话视图。
  //  两者互斥，任何时刻有且仅有一个承载选中态：
  //    - 路径匹配导航项路由 → 对应导航项高亮，会话行强制不高亮（双高亮防互抢）
  //    - 路径 '/' 且处于新建任务 draft 态（用户刚点「新建任务」，尚未发送首条消息）
  //      → 高亮「新建任务」（此时 currentSessionId=null，列表无"新对话"行，天然无双高亮）
  //    - 路径 '/' 且已选中具体会话 → 导航让位，会话行高亮（无论标题是否为"新对话"）
  //    - 路径 '/' 且无会话、非 draft（完全空态）→ 默认高亮「助理」（空状态视觉入口）
  // ============================================================
  const matchedNav = NAV_ITEMS.find((i) => i.route === location.pathname)
  const isChatView = !matchedNav && (location.pathname === '/' || location.pathname === '')
  // 会话行选中态开关：仅当处于会话视图（/）时允许；功能页路由时关闭
  const conversationSelectionEnabled = isChatView

  const activeNavKey = (() => {
    if (matchedNav) return matchedNav.key
    if (location.pathname === '/' || location.pathname === '') {
      // 新建任务 draft 态：指示「用户刚点击新建任务，处于初始对话状态」
      if (isDraftNewSession) return 'new-task'
      // 完全无 currentSessionId → 空态，用「助理」作为导航层兜底视觉焦点
      if (!currentSessionId) return 'assistant'
      // 已有 currentSessionId（不管标题是否默认）→ 会话行接管高亮，导航让位
      return ''
    }
    return ''
  })()

  // ---- 操作回调 ----
  const handleCreate = useCallback(async (): Promise<void> => {
    // Lazy Create：仅进入 draft 态（高亮「新建任务」），不创建后端会话、不在列表落库；
    // 首条消息发送时 sendMessage 才真正创建会话
    startNewTask()
    if (location.pathname !== '/' && location.pathname !== '') navigate('/')
  }, [startNewTask, location.pathname, navigate])

  const handleNavClick = useCallback(
    (item: NavItem) => {
      // 所有导航项均路由化：点击跳转到对应功能页（占位页内容"开发中，即将上线"）
      if (location.pathname !== item.route) navigate(item.route)
    },
    [location.pathname, navigate]
  )

  const handleToggleSidebar = useCallback(() => {
    setSidebarVisible(!sidebarVisible)
  }, [sidebarVisible, setSidebarVisible])

  // ---- 展示值 ----
  const displayName = user.nickname || user.username || '未登录'
  const displayInitial = displayName.slice(0, 1).toUpperCase()
  // 副标题按状态区分，避免「后端故障」被误显示为「未登录」
  const displaySubtitle = isAuthed
    ? user.email || '已登录'
    : isError
      ? '连接失败，点击重试'
      : '未登录'

  return (
    <div className="conversation-sidebar flex flex-col h-full bg-sidebar">
      <TooltipProvider delayDuration={200}>
        {/* ================================================ */}
        {/* 1. 品牌栏：Win/Linux 显示完整品牌栏（含工具栏按钮）；
              macOS 下工具栏按钮在标题栏，品牌栏整体隐藏 */}
        {/* ================================================ */}
        {!isMac && (
          <SidebarBrand
            sidebarVisible={sidebarVisible}
            onToggleSidebar={handleToggleSidebar}
          />
        )}

        {/* ================================================ */}
        {/* 2. 功能按钮区：新建任务 + 导航项 */}
        {/* ================================================ */}
        <SidebarNav
          activeNavKey={activeNavKey}
          onCreate={handleCreate}
          onNavClick={handleNavClick}
        />

        {/* ================================================ */}
        {/* 3. 分割线 */}
        {/* ================================================ */}
        <div className="mx-3 my-1 border-t border-border/60 shrink-0" />

        {/* ================================================ */}
        {/* 4. 任务 / 空间 分组 */}
        {/* ================================================ */}
        <div className="flex-1 min-h-0 flex flex-col px-3">
          {/* 任务 */}
          <SectionHeader
            title="任务"
            count={sessionsCount}
            expanded={tasksExpanded}
            onToggle={() => setTasksExpanded(!tasksExpanded)}
          />
          {tasksExpanded && (
            <div className="flex-1 basis-0 min-h-[60px] -mx-3">
              {/* 
                conversationSelectionEnabled：
                  - 会话视图（/）= true → 允许会话行按 currentSessionId 高亮
                  - 功能页（助理/技能/插件/自动化/更多）= false → 强制不高亮会话行，
                    避免「导航项 + 会话行」双高亮互抢焦点（恰好一个承载选中态）
              */}
              <ConversationList selectionEnabled={conversationSelectionEnabled} />
            </div>
          )}

          {/* 空间（占位） */}
          <SectionHeader
            title="空间"
            count={0}
            expanded={spacesExpanded}
            onToggle={() => setSpacesExpanded(!spacesExpanded)}
            placeholder
          />
          {spacesExpanded && (
            <div className={cn('flex-1 basis-0 min-h-0 px-4 py-4 text-center', !tasksExpanded && 'flex items-center justify-center')}>
              <p className="text-[11px] text-muted-foreground/50">即将开放</p>
            </div>
          )}
        </div>

        {/* ================================================ */}
        {/* 5. 底部：账户菜单 */}
        {/* ================================================ */}
        <AccountMenu
          displayName={displayName}
          displayInitial={displayInitial}
          displaySubtitle={displaySubtitle}
          isAuthed={isAuthed}
          isSettling={isSettling}
          isError={isError}
          avatar={user.avatar}
        />
      </TooltipProvider>
    </div>
  )
})
