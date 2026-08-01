// ============================================================
// Sidebar — 左栏（品牌栏 + 导航 + 任务/空间分组 + 账户）
// ============================================================

import { memo, useEffect, useCallback, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  settingsOpenAtom,
  settingsCategoryAtom,
  sidebarVisibleAtom
} from '@/stores/atoms'
import { authViewAtom } from '@/stores/authStore'
import { useAppStore, type ThemeMode } from '@/stores/useAppStore'
import { runMenuAction } from '@/menu/menuActions'
import {
  Settings,
  Sun,
  Moon,
  Monitor,
  HelpCircle,
  LogOut,
  LogIn,
  User,
  ChevronRight,
  PanelLeft,
  MessageCirclePlus,
  ChevronDown,
  Sparkles,
  FolderOpen,
  GraduationCap,
  Zap,
  Ellipsis,
  Search,
  SlidersHorizontal
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { authService } from '@/services/api/auth'
import { ConversationList } from './ConversationList'
import { useChatStore } from '../../stores/chatStore'
import { usePlatform } from '@/hooks/usePlatform'

// ============================================================
// 导航菜单配置（无对应功能的条目使用 placeholder: true）
// ============================================================
const NAV_ITEMS = [
  { key: 'assistant', label: '助理', icon: Sparkles, route: '/', placeholder: false },
  { key: 'skills', label: '技能', icon: FolderOpen, route: '', placeholder: true },
  {
    key: 'plugins',
    label: '插件',
    icon: GraduationCap,
    route: '',
    placeholder: true
  },
  { key: 'automation', label: '自动化', icon: Zap, route: '', placeholder: true },
  {
    key: 'more',
    label: '更多',
    icon: Ellipsis,
    route: '',
    placeholder: true,
    extra: '知识库'
  }
]

// ============================================================
// 子组件：分组标题（任务/空间，"标题 (数量)" + 下拉箭头）
// ============================================================
function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
  placeholder
}: {
  title: string
  count: number
  expanded: boolean
  onToggle: () => void
  placeholder?: boolean
}) {
  return (
    <div
      onClick={onToggle}
      className={cn(
        'flex items-center justify-between h-[34px] px-3 gap-2 cursor-pointer select-none transition-colors rounded-[8px] hover:bg-accent/40',
        placeholder && 'opacity-60'
      )}
    >
      <span className="text-xs font-normal text-muted-foreground">
        {title} ({count})
      </span>
      {/* 折叠时显示 chevron-right，展开时显示 chevron-down */}
      {expanded ? (
        <ChevronDown
          className="size-4 text-muted-foreground/60 shrink-0"
          strokeWidth={1.5}
        />
      ) : (
        <ChevronRight
          className="size-4 text-muted-foreground/60 shrink-0"
          strokeWidth={1.5}
        />
      )}
    </div>
  )
}

// ============================================================
// Sidebar
// ============================================================
export const Sidebar = memo(function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsCategory = useSetAtom(settingsCategoryAtom)
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const { isMac } = usePlatform()

  // 认证态统一来自 authStore：Sidebar 不再自行判断登录态或拉取资料，
  // 从根本上消除「effect 抢跑 token 恢复」的竞态。
  const { user, isAuthed, isSettling, isError } = useAtomValue(authViewAtom)

  // 主题
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

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
  // 登出后的状态重置由 authStore 订阅 token 变化自动完成，此处无需手动清 user
  const handleLogout = useCallback(() => {
    void authService.logout()
  }, [])

  // 未登录时引导至设置中的认证分区
  const handleLoginClick = useCallback(() => {
    setSettingsCategory('auth')
    setSettingsOpen(true)
  }, [setSettingsCategory, setSettingsOpen])

  const openSettingsWithCategory = useCallback(
    (categoryId: string) => {
      setSettingsCategory(categoryId)
      setSettingsOpen(true)
    },
    [setSettingsCategory, setSettingsOpen]
  )

  const handleCreate = useCallback(async () => {
    await createSession()
    setActiveNavKey('new-task')
    navigate('/')
  }, [createSession, navigate])

  const handleNavClick = useCallback(
    (item: (typeof NAV_ITEMS)[number]) => {
      setActiveNavKey(item.key)
      if (item.placeholder) {
        // 占位功能：不跳转，仅切换视觉激活态
        return
      }
      navigate(item.route)
    },
    [navigate]
  )

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
          <div className="conversation-list-header px-3 pt-3 pb-0 shrink-0">
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
                      onClick={() => setSidebarVisible(!sidebarVisible)}
                    >
                      {sidebarVisible ? (
                        <PanelLeft className="size-4" />
                      ) : (
                        <PanelLeft className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="center" className="text-xs">
                    {sidebarVisible ? '收起侧边栏' : '展开侧边栏'}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        )}

        {/* ================================================ */}
        {/* 2. 功能按钮区
              - 容器 px-3 统一 12px 左右边距
              - 所有项圆角统一 rounded-[14px]，垂直间距统一 mb-1
              - 新建任务：主操作按钮，始终带 bg-accent 背景
              - 助理/技能/插件/自动化/更多：默认透明灰字，激活态与主按钮一致 bg-accent
              - 所有项高度统一 h-11，内部 px-3（12px），图标 16px 与文字 14px 协调 */}
        {/* ================================================ */}
        <div className={cn('px-3 pb-1 shrink-0', isMac ? 'pt-3.5' : 'pt-[18px]')}>
          {/* ---- 主按钮：新建任务（默认透明，hover 浅灰，激活态实色块） ---- */}
          <Button
            variant="ghost"
            className={cn(
              'w-full h-[32px] px-3 gap-2 justify-start rounded-[8px] text-muted-foreground hover:bg-accent/40 hover:text-foreground shadow-none mb-1 font-normal [&_svg]:size-4',
              activeNavKey === 'new-task' && 'bg-accent text-foreground hover:bg-accent/80'
            )}
            onClick={handleCreate}
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
                onClick={() => handleNavClick(item)}
                className={cn(
                  'flex items-center justify-between h-[32px] px-3 gap-2 rounded-[8px] cursor-pointer select-none transition-colors mb-1',
                  isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
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

        {/* ================================================ */}
        {/* 4. 分割线 */}
        {/* ================================================ */}
        <div className="mx-3 my-1 border-t border-border/60 shrink-0" />

        {/* ================================================ */}
        {/* 5. 任务 / 空间 分组 */}
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
        {/* 6. 底部：账户菜单 */}
        {/* min-h 兜底：父容器是 flex flex-col + 中段 flex-1，
            在内容极少时若中部被挤光，底部菜单可能仍存在但视觉上看起来
            "消失了"；给底部一个固定的最小高度，确保锚定在视口底端 */}
        {/* ================================================ */}
        <div className="conversation-list-footer flex items-center justify-between px-2 py-1.5 border-t border-border shrink-0 min-h-[44px]">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring w-[220px] shrink-0"
                title="账户菜单"
              >
                {isSettling ? (
                  // 认证态未定：展示骨架屏而非「未登录」，避免误导
                  <>
                    <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-muted" />
                    <div className="flex flex-col items-start gap-1 min-w-0">
                      <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                      <div className="h-2.5 w-28 animate-pulse rounded bg-muted/70" />
                    </div>
                  </>
                ) : (
                  <>
                    <Avatar className="h-7 w-7">
                      {user.avatar ? (
                        <AvatarImage src={user.avatar} alt={displayName} />
                      ) : null}
                      <AvatarFallback className="text-[11px] font-medium">
                        {displayInitial}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-start min-w-0">
                      <span className="max-w-[120px] truncate text-xs font-medium text-foreground">
                        {displayName}
                      </span>
                      <span
                        className={cn(
                          'max-w-[120px] truncate text-[10px]',
                          isError ? 'text-destructive' : 'text-muted-foreground'
                        )}
                      >
                        {displaySubtitle}
                      </span>
                    </div>
                  </>
                )}
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              side="top"
              align="start"
              className="w-64 rounded-[10px] border-border/60 p-1 shadow-lg [&_[role=menuitem]]:py-1.5 [&_[role=separator]]:my-1.5"
            >
              <DropdownMenuLabel className="px-2 py-2.5">
                <div className="truncate text-sm font-medium">{displayName}</div>
                <div
                  className={cn(
                    'truncate text-[11px] font-normal',
                    isError ? 'text-destructive' : 'text-muted-foreground'
                  )}
                >
                  {displaySubtitle}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              <DropdownMenuItem onSelect={() => openSettingsWithCategory('account')}>
                <User />
                个人中心
                <ChevronRight className="ml-auto size-3.5 text-muted-foreground/60" />
              </DropdownMenuItem>

              <DropdownMenuItem onSelect={() => openSettingsWithCategory('appearance')}>
                <Sun className="size-4" />
                外观设置
                <ChevronRight className="ml-auto size-3.5 text-muted-foreground/60" />
              </DropdownMenuItem>

              <DropdownMenuItem onSelect={() => runMenuAction('openDocs')}>
                <HelpCircle />
                帮助与反馈
                <ChevronRight className="ml-auto size-3.5 text-muted-foreground/60" />
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Sun className="size-4" />
                  <span>主题</span>
                  <span className="ml-auto text-[11px] text-muted-foreground/60">
                    {theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[150px]">
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(v) => setTheme(v as ThemeMode)}
                  >
                    <DropdownMenuRadioItem value="light" className="flex items-center gap-2">
                      <Sun className="size-4 text-amber-500" />
                      <span>浅色</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark" className="flex items-center gap-2">
                      <Moon className="size-4 text-blue-400" />
                      <span>深色</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system" className="flex items-center gap-2">
                      <Monitor className="size-4 text-muted-foreground" />
                      <span>跟随系统</span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuItem onSelect={() => openSettingsWithCategory('about')}>
                <Settings />
                关于软件
                <ChevronRight className="ml-auto size-3.5 text-muted-foreground/60" />
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              {/* 仅在确认已登录时提供登出；未登录时改为提供登录入口，
                  避免出现「未登录却可点退出登录」的无效操作 */}
              {isAuthed ? (
                <DropdownMenuItem
                  onSelect={handleLogout}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <LogOut />
                  退出登录
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={handleLoginClick} disabled={isSettling}>
                  <LogIn />
                  {isError ? '重新连接并登录' : '登录账户'}
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-center text-[10px] text-muted-foreground/50">
                Pioneering v0.1.0
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TooltipProvider>
    </div>
  )
})
