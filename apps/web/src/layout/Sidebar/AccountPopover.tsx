/**
 * 侧边栏底部账号弹层（从 Sidebar.tsx 拆出）
 * - DropdownMenu / ui-avatar / sonner / lucide
 * - 登出撤销 token、主题切换、设置/帮助入口等逻辑保持不变；
 *   菜单顺序对齐豆包：设置 / 外观设置（级联：跟随系统·浅色·深色）/
 *   收藏夹 / 官网 / 下载电脑版 / 帮助与反馈 / 退出，
 *   其中收藏夹、官网、下载电脑版为置灰占位项（toast「功能开发中」）
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  BookmarkPlus,
  Check,
  CircleHelp,
  Globe,
  LogOut,
  Monitor,
  MonitorDown,
  Moon,
  Palette,
  Settings,
  Sun,
} from 'lucide-react';
import { useTheme } from '../../store/themeContext';
import { useSettingsDialogStore } from '../../store/settingsDialogStore';
import { useAuth } from '../../hooks/useAuth';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from './ConfirmDialog';

export function AccountPopover() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const [logoutOpen, setLogoutOpen] = useState(false);
  // 设置对话框由 AppLayout 全局挂载（见 settingsDialogStore），这里只负责唤起
  const openSettings = useSettingsDialogStore((s) => s.openSettings);

  const displayName = user?.nickname || user?.username || '未命名用户';
  const initial = (user?.nickname || user?.username || '?')
    .charAt(0)
    .toUpperCase();

  /** 确认退出登录：调后端撤销 token + 清本地 + 跳登录页 */
  const handleLogout = useCallback(async () => {
    setLogoutOpen(false);
    setOpen(false);
    try {
      await logout();
      toast.success('已登出');
    } catch {
      toast.error('退出失败，请重试');
    }
  }, [logout]);

  /**
   * Radix 已知时序问题：键盘操作菜单项时 DropdownMenu 会给 body 加
   * pointer-events:none；紧接着挂载弹层会把这个"已锁定"状态当作旧值，
   * 关弹窗时恢复成 none，导致全页鼠标点击失效。在选中菜单项、弹层挂载前
   * 同步清除，使弹层捕获到的是未锁定状态。
   */
  const resetBodyPointerEvents = () => {
    document.body.style.pointerEvents = '';
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <div
            className="sidebar-account-trigger"
            role="button"
            tabIndex={0}
            aria-label="账号菜单"
            aria-haspopup="menu"
            aria-expanded={open}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen((prev) => !prev);
              }
            }}
          >
            <Avatar className="sidebar-avatar">
              {user?.avatar && (
                <AvatarImage src={user.avatar} alt={displayName} />
              )}
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{displayName}</div>
              <div className="sidebar-user-plan">
                @{user?.username || '—'}
              </div>
            </div>
          </div>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="account-popover"
        >
          {/* 菜单顺序对齐豆包：设置 / 外观 / 收藏夹 ｜ 官网 / 检查更新 / 帮助 ｜ 退出 */}
          <DropdownMenuItem
            className="account-popover-item"
            onSelect={() => {
              resetBodyPointerEvents();
              openSettings('general');
            }}
          >
            <Settings />
            设置
          </DropdownMenuItem>

          {/* 外观设置：级联子菜单（跟随系统 / 浅色模式 / 深色模式），右侧箭头展开，
              当前模式末位显示对勾（对齐豆包） */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="account-popover-item account-popover-subtrigger">
              <Palette />
              外观设置
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className="account-popover account-popover--sub"
              sideOffset={8}
            >
              <DropdownMenuItem
                className="account-popover-item"
                onSelect={() => {
                  resetBodyPointerEvents();
                  setTheme('system');
                }}
              >
                <Monitor />
                跟随系统
                {theme === 'system' && <Check className="account-popover-check" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="account-popover-item"
                onSelect={() => {
                  resetBodyPointerEvents();
                  setTheme('light');
                }}
              >
                <Sun />
                浅色模式
                {theme === 'light' && <Check className="account-popover-check" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="account-popover-item"
                onSelect={() => {
                  resetBodyPointerEvents();
                  setTheme('dark');
                }}
              >
                <Moon />
                深色模式
                {theme === 'dark' && <Check className="account-popover-check" />}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* 收藏夹：功能未上线，置灰占位（不使用 Radix disabled，需保留点击 toast） */}
          <DropdownMenuItem
            className="account-popover-item account-popover-item--pending"
            onSelect={() => toast.info('功能开发中')}
          >
            <BookmarkPlus />
            收藏夹
          </DropdownMenuItem>

          <DropdownMenuSeparator className="account-popover-divider" />

          {/* 创路Agent 官网：链接未提供，置灰占位 */}
          <DropdownMenuItem
            className="account-popover-item account-popover-item--pending"
            onSelect={() => toast.info('功能开发中')}
          >
            <Globe />
            创路Agent官网
          </DropdownMenuItem>

          {/* 下载创路电脑版：下载链接未提供，置灰占位 */}
          <DropdownMenuItem
            className="account-popover-item account-popover-item--pending"
            onSelect={() => toast.info('功能开发中')}
          >
            <MonitorDown />
            下载创路电脑版
          </DropdownMenuItem>

          <DropdownMenuItem
            className="account-popover-item"
            onSelect={() => {
              resetBodyPointerEvents();
              openSettings('help');
            }}
          >
            <CircleHelp />
            帮助与反馈
          </DropdownMenuItem>

          <DropdownMenuSeparator className="account-popover-divider" />

          <DropdownMenuItem
            className="account-popover-item account-popover-logout focus:bg-[var(--accent-red-light)] focus:text-[var(--accent-red)]"
            onSelect={() => {
              resetBodyPointerEvents();
              setLogoutOpen(true);
            }}
          >
            <LogOut />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="退出登录"
        description="确认退出当前账号吗？"
        confirmText="确认退出"
        onConfirm={() => void handleLogout()}
      />
    </>
  );
}
