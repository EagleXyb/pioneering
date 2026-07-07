// ============================================================
// Sidebar — 左栏（会话历史）
// ============================================================

import { useAtom } from 'jotai'
import { settingsOpenAtom, userAtom } from '@/stores/atoms'
import { useAppStore, type ThemeMode } from '@/stores/useAppStore'
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

export function Sidebar() {
  const [, setSettingsOpen] = useAtom(settingsOpenAtom)
  const [user] = useAtom(userAtom)
  const { theme, setTheme } = useAppStore()

  // ===== 各菜单项的处理接口（预留，后续接入真实逻辑） =====
  const handleSettings = () => setSettingsOpen(true)
  const handleHelp = () => {
    // TODO: 打开帮助与反馈（文档/工单/社区）
    window.open('https://docs.pioneering.ai', '_blank')
  }
  const handleCheckUpdate = () => {
    // TODO: 调用更新检查接口
    void window.api?.app?.checkUpdate?.()
  }
  const handleLogout = () => {
    // TODO: 调用退出登录接口
    void window.api?.auth?.logout?.()
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

            <DropdownMenuItem onSelect={handleSettings}>
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

            <DropdownMenuItem onSelect={handleHelp}>
              <HelpCircle />
              帮助与反馈
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleCheckUpdate}>
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
}
