/**
 * 侧边栏底部账号弹层（阶段 3.4 从 Sidebar.tsx 拆出）
 * - TDesign Popup/Dialog/Avatar/Loading/MessagePlugin/图标
 *   → DropdownMenu / ui-dialog / ui-avatar / Spinner / sonner / lucide
 * - 个人中心资料拉取、复制、登出撤销 token、主题切换、设置/帮助入口等逻辑
 *   零改动平移；外观行沿用自绘滑动分段控件（.theme-switch*）
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  CircleHelp,
  Copy,
  LogOut,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  UserRound,
} from 'lucide-react';
import { useTheme } from '../../store/themeContext';
import { useAuth } from '../../hooks/useAuth';
import { getProfileApi } from '../../api/auth-api';
import SettingsDialog from '../../components/SettingsDialog';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from './ConfirmDialog';

export function AccountPopover() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { user, logout, updateUser } = useAuth();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
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

  /** 拉取最新个人资料并同步到全局 store；失败沿用本地缓存静默忽略 */
  const refreshProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const fresh = await getProfileApi();
      updateUser(fresh);
    } catch {
      // 后端不可用时沿用本地缓存数据，不报错打断用户
    } finally {
      setProfileLoading(false);
    }
  }, [updateUser]);

  /** 格式化 createdAt（ISO 字符串）为可读日期 */
  const formatDate = (iso: string | undefined | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', { hour12: false });
  };

  /** 复制到剪贴板并提示 */
  const copyText = useCallback((text: string, label: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`已复制${label}`),
      () => toast.error('复制失败'),
    );
  }, []);

  /**
   * Radix 已知时序问题：键盘操作菜单项时 DropdownMenu 会给 body 加
   * pointer-events:none；紧接着挂载 Dialog 会把这个"已锁定"状态当作旧值，
   * 关弹窗时恢复成 none，导致全页鼠标点击失效。在选中菜单项、弹层挂载前
   * 同步清除，使 Dialog 捕获到的是未锁定状态。
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
              setProfileOpen(true);
              void refreshProfile();
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

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="w-[440px] max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle asChild>
              <div className="account-info-dialog-header">
                <span>个人中心</span>
                <button
                  type="button"
                  className="account-info-refresh"
                  onClick={() => void refreshProfile()}
                  disabled={profileLoading}
                  title={profileLoading ? '刷新中…' : '刷新资料'}
                  aria-label="刷新资料"
                >
                  <RefreshCw className={profileLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </DialogTitle>
          </DialogHeader>

          {profileLoading && !user ? (
            <div className="account-info-loading">
              <Spinner className="mr-2 h-4 w-4" />
              加载中…
            </div>
          ) : (
            <div className="account-info">
              <div className="account-info-header">
                <Avatar className="account-info-avatar h-16 w-16 text-base">
                  {user?.avatar && (
                    <AvatarImage src={user.avatar} alt={displayName} />
                  )}
                  <AvatarFallback>{initial}</AvatarFallback>
                </Avatar>
                <div className="account-info-name">
                  <div className="account-info-nickname">{displayName}</div>
                  <div className="account-info-username">
                    @{user?.username || '—'}
                  </div>
                </div>
              </div>

              <div className="account-info-list">
                <div className="account-info-row">
                  <span className="account-info-label">用户 ID</span>
                  <span className="account-info-value-group">
                    <span className="account-info-value account-info-mono">
                      {user?.id || '—'}
                    </span>
                    <button
                      type="button"
                      className="account-info-copy"
                      onClick={() => copyText(user?.id || '', '用户 ID')}
                      disabled={!user?.id}
                      title="复制用户 ID"
                      aria-label="复制用户 ID"
                    >
                      <Copy />
                    </button>
                  </span>
                </div>
                <div className="account-info-row">
                  <span className="account-info-label">用户名</span>
                  <span className="account-info-value">
                    {user?.username || '—'}
                  </span>
                </div>
                <div className="account-info-row">
                  <span className="account-info-label">昵称</span>
                  <span className="account-info-value">
                    {user?.nickname || '—'}
                  </span>
                </div>
                <div className="account-info-row">
                  <span className="account-info-label">邮箱</span>
                  <span className="account-info-value-group">
                    <span className="account-info-value">
                      {user?.email || '—'}
                    </span>
                    {user?.email && (
                      <button
                        type="button"
                        className="account-info-copy"
                        onClick={() => copyText(user.email || '', '邮箱')}
                        title="复制邮箱"
                        aria-label="复制邮箱"
                      >
                        <Copy />
                      </button>
                    )}
                  </span>
                </div>
                <div className="account-info-row">
                  <span className="account-info-label">手机号</span>
                  <span className="account-info-value">
                    {user?.phone || '—'}
                  </span>
                </div>
                <div className="account-info-row">
                  <span className="account-info-label">注册时间</span>
                  <span className="account-info-value">
                    {formatDate(user?.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SettingsDialog
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialSection={settingsSection}
      />
    </>
  );
}
