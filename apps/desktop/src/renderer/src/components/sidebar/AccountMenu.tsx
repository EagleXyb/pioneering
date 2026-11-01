// ============================================================
// AccountMenu — Sidebar 底部账户菜单
// ============================================================
// 头像/昵称/副标题触发 DropdownMenu，菜单内容与样式逐项复刻
// apps/web 的 AccountPopover（layout/Sidebar/AccountPopover.tsx +
// sidebar.css .account-popover）：
//   设置 / 外观设置（级联：跟随系统·浅色模式·深色模式，当前项对勾）/
//   收藏夹 / 创路Agent官网 / 下载创路电脑版 / 帮助与反馈 / 退出登录
// 规格（web .account-popover）：
//   · 容器：min-width 240px / 6px 内边距 / 16px 外圆角
//   · 行：10px×12px 内边距 / 10px 圆角 / 14px 字号 / 16px 图标 / 2px 上下间距
//   · hover：行内圆底 #e2e3e8（深色 #2c2c2c）
//   · 分隔线：1px，左右 4px、上下 6px 内缩（#e5e7eb / #2a2a2a）
//   · 占位项（收藏夹/官网/下载电脑版）：弱文字色 + 禁止光标
//   · 退出登录：常态同主文字色，hover 浅红底 + 红字
// ============================================================

import { useSetAtom } from 'jotai'
import {
  Settings,
  Sun,
  Moon,
  Monitor,
  Palette,
  BookmarkPlus,
  Globe,
  MonitorDown,
  CircleHelp,
  LogOut,
  Check
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  settingsOpenAtom,
  settingsCategoryAtom,
  openConfirmDialogAtom
} from '@/stores/atoms'
import { useAppStore } from '@/stores/useAppStore'
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

// ============================================================
// 菜单行统一视觉 token（逐项对齐 web .account-popover-item）
// ============================================================
/** 行：约 40px 高 / 14px 字 / 10×12px 内边距 / 10px 圆角 / 16px 图标 / 行内 hover */
const ITEM_CLASS =
  'my-0.5 !py-2.5 !px-3 !gap-[11px] rounded-[10px] text-[14px] font-normal text-[#1a1d23] dark:text-[#ededed] [&_svg]:size-4 focus:!bg-[#e2e3e8] dark:focus:!bg-[#2c2c2c]'
/** 置灰占位项：弱文字色 + 禁止光标 + 无 hover 高亮（web .account-popover-item--pending） */
const PENDING_ITEM_CLASS = cn(
  ITEM_CLASS,
  'cursor-not-allowed text-[#9ca3af] dark:text-[#7a7a7a]',
  '[&_svg]:text-[#9ca3af] dark:[&_svg]:text-[#7a7a7a]',
  'focus:!bg-transparent dark:focus:!bg-transparent focus:!text-[#9ca3af] dark:focus:!text-[#7a7a7a]'
)
/** 分隔线：左右 4px、上下 6px 内缩 */
const DIVIDER_CLASS = '!mx-1 !my-1.5 !bg-[#e5e7eb] dark:!bg-[#2a2a2a]'

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
  const openConfirm = useSetAtom(openConfirmDialogAtom)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  /** 退出登录：与 web 一致先弹确认框，确认后再登出 */
  const handleLogoutClick = () => {
    openConfirm({
      id: 'account-logout',
      title: '退出登录',
      description: '确认退出当前账号吗？',
      confirmText: '确认退出',
      confirmVariant: 'destructive',
      onConfirm: async () => {
        await authService.logout()
      }
    })
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
          sideOffset={8}
          className="min-w-[240px] rounded-[16px] !p-1.5"
        >
          {/* ===== 设置 ===== */}
          <DropdownMenuItem
            className={ITEM_CLASS}
            onSelect={() => openSettingsWithCategory('general')}
          >
            <Settings className="shrink-0" />
            <span className="truncate">设置</span>
          </DropdownMenuItem>

          {/* ===== 外观设置：级联子菜单（跟随系统 / 浅色 / 深色），当前项右侧对勾 ===== */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className={cn(
                ITEM_CLASS,
                '[&>svg:last-child]:text-[#9ca3af] dark:[&>svg:last-child]:text-[#7a7a7a]'
              )}
            >
              <Palette className="shrink-0" />
              <span className="truncate">外观设置</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[196px] rounded-[16px] !p-1.5">
              <DropdownMenuItem className={ITEM_CLASS} onSelect={() => setTheme('system')}>
                <Monitor className="shrink-0" />
                <span>跟随系统</span>
                {theme === 'system' && <Check className="ml-auto shrink-0" />}
              </DropdownMenuItem>
              <DropdownMenuItem className={ITEM_CLASS} onSelect={() => setTheme('light')}>
                <Sun className="shrink-0" />
                <span>浅色模式</span>
                {theme === 'light' && <Check className="ml-auto shrink-0" />}
              </DropdownMenuItem>
              <DropdownMenuItem className={ITEM_CLASS} onSelect={() => setTheme('dark')}>
                <Moon className="shrink-0" />
                <span>深色模式</span>
                {theme === 'dark' && <Check className="ml-auto shrink-0" />}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* ===== 占位项（功能未上线）：弱文字色 + 禁止光标 ===== */}
          <DropdownMenuItem className={PENDING_ITEM_CLASS} onSelect={() => undefined}>
            <BookmarkPlus className="shrink-0" />
            <span className="truncate">收藏夹</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator className={DIVIDER_CLASS} />

          <DropdownMenuItem className={PENDING_ITEM_CLASS} onSelect={() => undefined}>
            <Globe className="shrink-0" />
            <span className="truncate">创路Agent官网</span>
          </DropdownMenuItem>

          <DropdownMenuItem className={PENDING_ITEM_CLASS} onSelect={() => undefined}>
            <MonitorDown className="shrink-0" />
            <span className="truncate">下载创路电脑版</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            className={ITEM_CLASS}
            onSelect={() => openSettingsWithCategory('help')}
          >
            <CircleHelp className="shrink-0" />
            <span className="truncate">帮助与反馈</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator className={DIVIDER_CLASS} />

          {/* ===== 退出登录：常态同主文字色，hover 浅红底 + 红字 ===== */}
          <DropdownMenuItem
            className={cn(
              ITEM_CLASS,
              'focus:!bg-[#fee2e2] dark:focus:!bg-[#3a1c1c] focus:!text-[#ef4444] dark:focus:!text-[#f87171]'
            )}
            onSelect={handleLogoutClick}
          >
            <LogOut className="shrink-0" />
            <span className="truncate">退出登录</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
