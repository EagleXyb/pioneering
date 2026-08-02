// ============================================================
// AccountMenu — Sidebar 底部账户菜单
// ============================================================
// 头像/昵称/副标题触发 DropdownMenu，含：
//   个人中心 / 外观设置 / 帮助与反馈 / 主题子菜单 / 关于软件 / 登录或登出
// 提取自 Sidebar.tsx。
// ============================================================

import { useAtomValue, useSetAtom } from 'jotai'
import {
  Settings,
  Sun,
  Moon,
  Monitor,
  HelpCircle,
  LogOut,
  LogIn,
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
import { cn } from '@/lib/utils'
import { settingsOpenAtom, settingsCategoryAtom } from '@/stores/atoms'
import { authViewAtom } from '@/stores/authStore'
import { useAppStore, type ThemeMode } from '@/stores/useAppStore'
import { runMenuAction } from '@/menu/menuActions'
import { authService } from '@/services/api/auth'

export interface AccountMenuProps {
  /** 认证态已定（非 settling）时传入 user 等展示值 */
  displayName: string
  displayInitial: string
  displaySubtitle: string
  isAuthed: boolean
  isSettling: boolean
  isError: boolean
  avatar?: string | null
}

/**
 * 底部账户菜单。认证态未定时展示骨架屏，已定时展示头像与昵称。
 */
export function AccountMenu({
  displayName,
  displayInitial,
  displaySubtitle,
  isAuthed,
  isSettling,
  isError,
  avatar
}: AccountMenuProps) {
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsCategory = useSetAtom(settingsCategoryAtom)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  const handleLogout = () => {
    void authService.logout()
  }

  const handleLoginClick = () => {
    setSettingsCategory('auth')
    setSettingsOpen(true)
  }

  const openSettingsWithCategory = (categoryId: string) => {
    setSettingsCategory(categoryId)
    setSettingsOpen(true)
  }

  return (
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
                  {avatar ? <AvatarImage src={avatar} alt={displayName} /> : null}
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
  )
}
