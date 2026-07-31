// ============================================================
// Sidebar — 左栏（品牌栏 + 导航 + 任务/空间分组 + 账户）
// ============================================================

import { memo, useEffect, useCallback, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  userAtom,
  settingsOpenAtom,
  settingsCategoryAtom,
  sidebarVisibleAtom
} from '@/stores/atoms'
import { useAppStore, type ThemeMode } from '@/stores/useAppStore'
import { runMenuAction } from '@/menu/menuActions'
import {
  Settings,
  Sun,
  Moon,
  Monitor,
  HelpCircle,
  LogOut,
  User,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
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
// 子组件：分组标题
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
        'flex items-center justify-between px-3 py-2 cursor-pointer select-none group',
        placeholder && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span
          className={cn(
            'text-[10px] leading-none px-1.5 py-0.5 rounded-full',
            placeholder ? 'bg-muted text-muted-foreground' : 'bg-accent text-muted-foreground'
          )}
        >
          {count}
        </span>
      </div>
      <ChevronDown
        className={cn(
          'h-3.5 w-3.5 text-muted-foreground/60 transition-transform',
          expanded && 'rotate-180'
        )}
      />
    </div>
  )
}

// ============================================================
// Sidebar
// ============================================================
export const Sidebar = memo(function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useAtom(userAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsCategory = useSetAtom(settingsCategoryAtom)
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const { isMac } = usePlatform()

  // 主题
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  // 会话数据（仅用于计数与新建）
  const sessionsCount = useChatStore((s) => s.sessions.length)
  const createSession = useChatStore((s) => s.createSession)

  // 分组折叠状态
  const [tasksExpanded, setTasksExpanded] = useState(true)
  const [spacesExpanded, setSpacesExpanded] = useState(true)

  // 导航激活态：助理页 = /，其余用本地 activeNavKey
  const [activeNavKey, setActiveNavKey] = useState('assistant')
  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '') {
      setActiveNavKey('assistant')
    }
  }, [location.pathname])

  // ---- 挂载时拉取用户资料 ----
  useEffect(() => {
    if (!authService.isAuthenticated()) return
    authService
      .getProfile()
      .then((p) => {
        setUser({
          id: p.id,
          username: p.username,
          nickname: p.nickname ?? null,
          email: p.email ?? null,
          avatar: p.avatar ?? null
        })
      })
      .catch(() => {})
  }, [setUser])

  // ---- 操作回调 ----
  const handleLogout = useCallback(() => {
    void authService.logout().finally(() => {
      setUser({
        id: '',
        username: '未登录',
        nickname: null,
        email: null,
        avatar: null
      })
    })
  }, [setUser])

  const openSettingsWithCategory = useCallback(
    (categoryId: string) => {
      setSettingsCategory(categoryId)
      setSettingsOpen(true)
    },
    [setSettingsCategory, setSettingsOpen]
  )

  const handleCreate = useCallback(async () => {
    await createSession()
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

  return (
    <div className="conversation-sidebar flex flex-col h-full bg-sidebar">
      <TooltipProvider delayDuration={200}>
        {/* ================================================ */}
        {/* 1. 品牌栏：Win/Linux 显示完整品牌栏（含工具栏按钮）；
              macOS 下工具栏按钮在标题栏，品牌栏整体隐藏 */}
        {/* ================================================ */}
        {!isMac && (
          <div className="conversation-list-header px-3 pt-3 pb-0 shrink-0">
            <div className="flex items-center justify-between py-1">
              {/* 左侧：Logo + 名称 + 版本 */}
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded bg-sidebar-primary flex items-center justify-center">
                  <span className="text-[10px] font-bold text-sidebar-primary-foreground">
                    P
                  </span>
                </div>
                <span className="text-xs font-semibold text-foreground/90">Pioneering</span>
                <span className="text-[10px] text-muted-foreground/50 ml-0.5">v0.1.0</span>
              </div>

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
                        <PanelLeftClose className="size-4" />
                      ) : (
                        <PanelLeftOpen className="size-4" />
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
        {/* 2. 新建任务 */}
        {/* ================================================ */}
        <div className={cn('px-3 pb-2 shrink-0', isMac ? 'pt-2' : 'pt-3')}>
          <Button
            variant="ghost"
            size="sm"
            className="group/new-task w-full h-9 px-3 justify-start gap-2.5 text-xs font-normal rounded-[8px] shadow-none bg-accent hover:bg-accent/50"
            onClick={handleCreate}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-accent text-foreground">
              <MessageCirclePlus className="h-4 w-4" />
            </span>
            <span className="text-sm font-medium text-foreground">新建任务</span>
          </Button>
        </div>

        {/* ================================================ */}
        {/* 3. 导航菜单 */}
        {/* ================================================ */}
        <div className="px-3 py-1 shrink-0 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = activeNavKey === item.key
            return (
              <div
                key={item.key}
                onClick={() => handleNavClick(item)}
                className={cn(
                  'flex items-center justify-between h-[32px] px-2.5 rounded-[8px] cursor-pointer transition-colors select-none',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-xs">{item.label}</span>
                </div>
                {'extra' in item && item.extra && (
                  <span className="text-[10px] text-muted-foreground/50 ml-auto mr-0">
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
        {/* 5. 任务 / 空间 分组（flex 列布局，上方任务列表下方空间占位） */}
        {/* ================================================ */}
        <div className="flex-1 min-h-0 flex flex-col">
          {/* 任务 */}
          <SectionHeader
            title="任务"
            count={sessionsCount}
            expanded={tasksExpanded}
            onToggle={() => setTasksExpanded(!tasksExpanded)}
          />
          {tasksExpanded && (
            <div className="flex-1 basis-0 min-h-[60px]">
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
            <div className={cn('flex-1 basis-0 min-h-0 px-3 py-4 text-center', !tasksExpanded && 'flex items-center justify-center')}>
              <p className="text-[11px] text-muted-foreground/50">即将开放</p>
            </div>
          )}
        </div>

        {/* ================================================ */}
        {/* 6. 底部：账户菜单 */}
        {/* ================================================ */}
        <div className="conversation-list-footer flex items-center justify-between px-2 py-1.5 border-t border-border shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring w-[220px] shrink-0"
                title="账户菜单"
              >
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
                  <span className="max-w-[120px] truncate text-[10px] text-muted-foreground">
                    {user.email || '未登录'}
                  </span>
                </div>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              side="top"
              align="start"
              className="w-64 rounded-[10px] border-border/60 p-1 shadow-lg [&_[role=menuitem]]:py-1.5 [&_[role=separator]]:my-1.5"
            >
              <DropdownMenuLabel className="px-2 py-2.5">
                <div className="truncate text-sm font-medium">{displayName}</div>
                <div className="truncate text-[11px] font-normal text-muted-foreground">
                  {user.email || '未登录'}
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
              <DropdownMenuItem
                onSelect={handleLogout}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <LogOut />
                退出登录
              </DropdownMenuItem>

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
