/**
 * 侧边栏底部账号弹层（从 Sidebar.tsx 拆出）
 * - DropdownMenu / ui-avatar / sonner / lucide
 * - 登出撤销 token、主题切换、设置/帮助/个人中心入口等逻辑保持不变；
 *   个人资料明细已并入设置框「账户」分区（个人中心入口定位到该分区），
 *   外观行沿用自绘滑动分段控件（.theme-switch*）
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  CircleHelp,
  LogOut,
  Moon,
  Settings,
  Sun,
  UserRound,
} from 'lucide-react';
import { useTheme } from '../../store/themeContext';
import { useAuth } from '../../hooks/useAuth';
import SettingsDialog from '../../components/SettingsDialog';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from './ConfirmDialog';

export function AccountPopover() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string>('general');

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
          <DropdownMenuItem
            className="account-popover-item"
            onSelect={() => {
              resetBodyPointerEvents();
              setSettingsSection('account');
              setSettingsOpen(true);
            }}
          >
            <UserRound />
            个人中心
          </DropdownMenuItem>

          {/* 外观行：自定义非菜单项，点击不关闭弹层 */}
          <div className="account-popover-row">
            <div className="account-popover-item-static">外观</div>
            <div className="theme-switch" role="radiogroup" aria-label="主题外观">
              <button
                type="button"
                role="radio"
                aria-checked={theme === 'light'}
                className={`theme-switch-option${theme === 'light' ? ' active' : ''}`}
                onClick={() => setTheme('light')}
              >
                <Sun />
                浅色
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={theme === 'dark'}
                className={`theme-switch-option${theme === 'dark' ? ' active' : ''}`}
                onClick={() => setTheme('dark')}
              >
                <Moon />
                深色
              </button>
              <span
                className={`theme-switch-thumb theme-switch-thumb--${theme === 'dark' ? 'dark' : 'light'}`}
              />
            </div>
          </div>

          <DropdownMenuItem
            className="account-popover-item"
            onSelect={() => {
              resetBodyPointerEvents();
              setSettingsSection('general');
              setSettingsOpen(true);
            }}
          >
            <Settings />
            设置
          </DropdownMenuItem>

          <DropdownMenuItem
            className="account-popover-item"
            onSelect={() => {
              resetBodyPointerEvents();
              setSettingsSection('help');
              setSettingsOpen(true);
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

      <SettingsDialog
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialSection={settingsSection}
      />
    </>
  );
}
