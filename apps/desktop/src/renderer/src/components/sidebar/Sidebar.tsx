// ============================================================
// Sidebar — 左栏（会话历史）
// ============================================================

import { memo } from 'react'
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
  const [user] = useAtom(userAtom)
  // 订阅粒度细化：仅订阅 theme / setTheme（P2-3）
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  // 设置/帮助/检查更新 复用统一菜单动作（runMenuAction），避免与全局菜单逻辑重复
  const handleLogout = () => {
    authService.logout()
  }

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
                {user.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt={user.name} />
                ) : null}
                <AvatarFallback className="text-[10px] font-medium">
                  {user.name.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="max-w-[110px] truncate text-xs text-foreground/80">
                {user.name}
              </span>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="py-2">
              <div className="truncate text-sm">{user.name}</div>
              <div className="truncate text-[11px] font-normal text-muted-foreground">
                {user.email}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={() => runMenuAction('about')}>
              <Settings />
              设置
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Sun />
                主题
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={theme}
                  onValueChange={(v) => setTheme(v as ThemeMode)}
                >
                  <DropdownMenuRadioItem value="light">
                    <Sun />
                    浅色
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Moon />
                    深色
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <Monitor />
                    跟随系统
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
