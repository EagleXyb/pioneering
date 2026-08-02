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

import { memo, useEffect, useCallback, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useNavigate, useLocation } from 'react-router-dom'
import { sidebarVisibleAtom } from '@/stores/atoms'
import { authViewAtom } from '@/stores/authStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ConversationList } from './ConversationList'
import { SidebarBrand } from './SidebarBrand'
import { SidebarNav, type NavItem } from './SidebarNav'
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

  // 会话数据（仅用于计数与新建）
  const sessionsCount = useChatStore((s) => s.sessions.length)
  const createSession = useChatStore((s) => s.createSession)

  // 分组折叠状态
  const [tasksExpanded, setTasksExpanded] = useState(true)
  const [spacesExpanded, setSpacesExpanded] = useState(true)

  // 导航激活态：助理页 = /，其余用本地 activeNavKey；
  // 'new-task' 为新建任务的独立激活标识（与助理同指向首页，但避免两者同时高亮）
  const [activeNavKey, setActiveNavKey] = useState('assistant')
  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '') {
      setActiveNavKey((prev) => (prev === 'new-task' ? prev : 'assistant'))
    }
  }, [location.pathname])

  // ---- 操作回调 ----
  const handleCreate = useCallback(async () => {
    await createSession()
    setActiveNavKey('new-task')
    navigate('/')
  }, [createSession, navigate])

  const handleNavClick = useCallback(
    (item: NavItem) => {
      setActiveNavKey(item.key)
      if (item.placeholder) {
        // 占位功能：不跳转，仅切换视觉激活态
        return
      }
      navigate(item.route)
    },
    [navigate]
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
              <ConversationList />
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
