// ============================================================
// Sidebar — 左栏（会话历史）
// ============================================================

import { memo, useEffect } from 'react'
import { useAtom } from 'jotai'
import { userAtom } from '@/stores/atoms'
import { useAppStore, type ThemeMode } from '@/stores/useAppStore'
import { runMenuAction } from '@/menu/menuActions'
import {
  Settings,
  Sun,
  Moon,
  Monitor,
  HelpCircle,
  RefreshCw,
  LogOut
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
  const handleLogout = () => {
    // logout 改为 async（S7），此处不阻塞 UI，best-effort 撤销后端 token
    void authService.logout()
  }

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
              className="flex items-center gap-2 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
              title="账户菜单"
            >
              <Avatar className="h-6 w-6">
                {user.avatar ? (
                  <AvatarImage src={user.avatar} alt={displayName} />
                ) : null}
                <AvatarFallback className="text-[10px] font-medium">
                  {displayInitial}
                </AvatarFallback>
              </Avatar>
              <span className="max-w-[110px] truncate text-xs text-foreground/80">
                {displayName}
              </span>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="py-2">
              <div className="truncate text-sm">{displayName}</div>
              <div className="truncate text-[11px] font-normal text-muted-foreground">
                {user.email || '—'}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={() => runMenuAction('about')}>
              <Settings />
              设置
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="flex items-center gap-2">
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
                  <DropdownMenuRadioItem value="light" className="flex items-center gap-3 py-2 pl-3 pr-4">
                    <Sun className="size-4 text-amber-500" />
                    <span>浅色</span>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark" className="flex items-center gap-3 py-2 pl-3 pr-4">
                    <Moon className="size-4 text-blue-400" />
                    <span>深色</span>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system" className="flex items-center gap-3 py-2 pl-3 pr-4">
                    <Monitor className="size-4 text-muted-foreground" />
                    <span>跟随系统</span>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem onSelect={() => runMenuAction('openDocs')}>
              <HelpCircle />
              帮助与反馈
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runMenuAction('checkUpdate')}>
              <RefreshCw />
              检查更新
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={handleLogout}
              className="text-destructive focus:text-destructive"
            >
              <LogOut />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="text-[10px] text-muted-foreground/40">v0.1.0</span>
      </div>
    </div>
  )
})
