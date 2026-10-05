// ============================================================
// AccountMenu — Sidebar 底部账户菜单
// ============================================================
// 头像/昵称/副标题触发 DropdownMenu，卡片式菜单，参照设计图：
//   ┌──────────────────────────────┐
//   │ desktop                      │  ← 大标题 + 灰色邮箱
//   │ desktop@example.com          │
//   ├──────────────────────────────┤  ← 通栏分隔线
//   │ 个人中心 / 外观设置 / 帮助与反馈 > │
//   ├──────────────────────────────┤
//   │ 主题      浅色（居中）       > │  ← 子菜单，黑色箭头
//   │ 关于软件                    > │
//   ├──────────────────────────────┤
//   │ ↪ 退出登录（红）             │
//   ├──────────────────────────────┤
//   │       Pioneering v0.1.0      │
//   └──────────────────────────────┘
// 规格（设计图等比换算，卡片宽 288px）：
//   · 圆角 16px / 无内边距（分隔线与 hover 通栏）
//   · 标题 20px 加粗；副标题 15px muted
//   · 行高 42px；行文字 18px；图标 16px；行内边距 18px
//   · 退出登录 #E7000B，行高 50px
//   · 底部版本 13px 居中
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { settingsOpenAtom, settingsCategoryAtom } from '@/stores/atoms'
import { useAppStore, type ThemeMode } from '@/stores/useAppStore'
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
// 卡片内统一视觉 token
// ============================================================
/** 普通行：36px 高 / 16px 字 / 18px 横向内边距 / 18px 图标 / 无圆角（通栏 hover） */
const ROW_CLASS =
  'h-[36px] !py-0 px-[18px] gap-3 rounded-none text-[16px] [&_svg]:size-[18px]'
/** 次级行（登录入口/退出登录）：46px 高 */
const ROW_CLASS_TALL =
  'h-[46px] !py-0 px-[18px] gap-3 rounded-none text-[16px] [&_svg]:size-[18px]'

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

  const themeLabel = theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'

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
          sideOffset={6}
          className="w-[288px] rounded-[16px] border-border/60 !p-0 shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
        >
          {/* ===== 头部：大标题 + 灰色副标题 ===== */}
          <div className="px-[18px] pt-5 pb-[22px]">
            {isSettling ? (
              <div className="flex flex-col gap-1.5 py-0.5">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-3 w-36 animate-pulse rounded bg-muted/70" />
              </div>
            ) : (
              <>
                <div className="truncate text-[20px] font-bold leading-snug text-foreground">
                  {displayName}
                </div>
                <div
                  className={cn(
                    'mt-1 truncate text-[15px]',
                    isError ? 'text-destructive' : 'text-muted-foreground'
                  )}
                >
                  {displaySubtitle}
                </div>
              </>
            )}
          </div>

          {/* 通栏分隔线 */}
          <DropdownMenuSeparator className="!mx-0 !my-0" />

          {/* ===== 分组 1：个人中心 / 外观设置 / 帮助与反馈 ===== */}
          <DropdownMenuItem className={ROW_CLASS} onSelect={() => openSettingsWithCategory('account')}>
            <User className="shrink-0" />
            <span className="truncate">个人中心</span>
            <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuItem>

          <DropdownMenuItem className={ROW_CLASS} onSelect={() => openSettingsWithCategory('appearance')}>
            <Sun className="shrink-0" />
            <span className="truncate">外观设置</span>
            <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuItem>

          <DropdownMenuItem className={ROW_CLASS} onSelect={() => openSettingsWithCategory('about')}>
            <HelpCircle className="shrink-0" />
            <span className="truncate">帮助与反馈</span>
            <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuItem>

          {/* 通栏分隔线 */}
          <DropdownMenuSeparator className="!mx-0 !my-0" />

          {/* ===== 分组 2：主题（子菜单）/ 关于软件 ===== */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={ROW_CLASS}>
              <Sun className="shrink-0" />
              <span className="truncate">主题</span>
              {/* 主题值：占据剩余空间并居中（与设计图一致），非 ml-auto 靠右 */}
              <span className="flex-1 text-center text-[13px] font-normal text-muted-foreground">
                {themeLabel}
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

          <DropdownMenuItem className={ROW_CLASS} onSelect={() => openSettingsWithCategory('about')}>
            <Settings className="shrink-0" />
            <span className="truncate">关于软件</span>
            <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuItem>

          {/* 通栏分隔线 */}
          <DropdownMenuSeparator className="!mx-0 !my-0" />

          {/* ===== 分组 3：退出登录 / 登录入口 =====
              仅在确认已登录时提供登出；未登录时改为提供登录入口，
              避免出现「未登录却可点退出登录」的无效操作 */}
          {isAuthed ? (
            <DropdownMenuItem
              onSelect={handleLogout}
              className={cn(
                ROW_CLASS_TALL,
                'text-[#E7000B] focus:text-[#E7000B] focus:bg-[#E7000B]/[0.07]'
              )}
            >
              <LogOut className="shrink-0" />
              <span className="truncate">退出登录</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={handleLoginClick}
              disabled={isSettling}
              className={ROW_CLASS_TALL}
            >
              <LogIn className="shrink-0" />
              <span className="truncate">{isError ? '重新连接并登录' : '登录账户'}</span>
            </DropdownMenuItem>
          )}

          {/* 通栏分隔线 */}
          <DropdownMenuSeparator className="!mx-0 !my-0" />

          {/* ===== 底部：版本号 ===== */}
          <div className="py-6 text-center text-[13px] text-muted-foreground/60 select-none">
            Pioneering v0.1.0
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
