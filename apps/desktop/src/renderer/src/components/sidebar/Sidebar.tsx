// ============================================================
// Sidebar — 左栏（会话历史）
// ============================================================

import { memo, useEffect, useCallback } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { userAtom, settingsOpenAtom, settingsCategoryAtom } from '@/stores/atoms'
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
  ChevronRight
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
import { ConversationList } from './ConversationList'
import { authService } from '@/services/api/auth'

export const Sidebar = memo(function Sidebar() {
  const [user, setUser] = useAtom(userAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsCategory = useSetAtom(settingsCategoryAtom)
  // 订阅粒度细化：仅订阅 theme / setTheme（P2-3）
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  // 挂载时拉取后端真实用户资料
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
      .catch(() => {
        // 拉取失败时保留占位数据，登录/重新登录后再更新
      })
  }, [setUser])

  // 设置/帮助/检查更新 复用统一菜单动作（runMenuAction），避免与全局菜单逻辑重复
  const handleLogout = useCallback(() => {
    // logout 改为 async（S7），此处不阻塞 UI，best-effort 撤销后端 token
    void authService.logout().finally(() => {
      // 登出后重置本地用户信息，避免侧边栏仍显示旧头像/昵称
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

  const displayName = user.nickname || user.username || '未登录'
  const displayInitial = displayName.slice(0, 1).toUpperCase()

  return (
    <div className="conversation-sidebar flex flex-col h-full bg-sidebar border-r border-border">
      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <ConversationList />
      </div>

      {/* Bottom: 头像 + 用户名 组合，点击弹出菜单 */}
      <div className="conversation-list-footer flex items-center justify-between px-2 py-1.5 border-t border-border shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
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

          <DropdownMenuContent side="top" align="start" className="w-64 rounded-[10px] border-border/60 p-1 shadow-lg [&_[role=menuitem]]:py-1.5 [&_[role=separator]]:my-1.5">
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
    </div>
  )
})
