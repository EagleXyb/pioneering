import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Dialog, MessagePlugin, Popup, Avatar, Radio } from 'tdesign-react';
import {
  SettingIcon,
  HelpCircleIcon,
  RefreshIcon,
  LogoutIcon,
  ModeLightIcon,
  ModeDarkIcon,
} from 'tdesign-icons-react';
import { useAppStore } from '../../store/appStore';
import { useConversationStore, type Conversation } from '../../store/conversationStore';
import { useTheme } from '../../store/themeContext';
import { useToast } from '../../store/toastContext';
import { useMode } from '../../hooks/useMode';
import { useAuth } from '../../hooks/useAuth';
import { getHealth } from '../../api/system';
import SettingsDialog from '../../components/SettingsDialog';
import type { AppMode } from '../../types';
import '../../styles/tokens.css';
import './sidebar.css';

function SidebarItem({ conv, isActive, onSelect, onDelete, onArchive, onRename, onRestore }: {
  conv: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onRename: (title: string) => void;
  onRestore?: () => void;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conv.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(conv.title);
    setIsRenaming(true);
    setMenuOpen(false);
  };

  const commitRename = () => {
    setIsRenaming(false);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conv.title) {
      onRename(trimmed);
    }
  };

  const cancelRename = () => {
    setIsRenaming(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    onDelete();
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(!menuOpen);
  };

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    onArchive();
  };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    showToast('置顶功能开发中');
  };

  const handleAnalyze = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    showToast('分享功能开发中');
  };

  const handleRestoreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    onRestore?.();
  };

  return (
    <div
      className={`sidebar-item${isActive ? ' active' : ''}`}
      role="button"
      tabIndex={0}
      title={conv.title}
      onClick={isRenaming ? undefined : onSelect}
      onKeyDown={(e) => {
        if (isRenaming) return;
        if (e.key === 'Enter') onSelect();
      }}
    >
      <div className="sidebar-item-inner">
        <span className="sidebar-item-mode-tag">
          {conv.mode === 'chat' && (
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" width="12" height="12">
              <path d="M2 3h10a1 1 0 011 1v5a1 1 0 01-1 1H5l-3 2V4a1 1 0 011-1z"/>
            </svg>
          )}
          {conv.mode === 'pro' && (
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" width="12" height="12">
              <path d="M2 2h4v4H2zM8 2h4v4H8zM2 8h4v4H2zM8 8h4v4H8z"/>
            </svg>
          )}
          {conv.mode === 'task' && (
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" width="12" height="12">
              <rect x="1" y="1" width="12" height="12" rx="2"/>
              <path d="M4 5h6M4 7h4M4 9h5"/>
            </svg>
          )}
        </span>
        {isRenaming ? (
          <input
            ref={inputRef}
            className="sidebar-item-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') cancelRename();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="sidebar-item-title" onDoubleClick={startRename}>{conv.title}</div>
        )}
      </div>
      <div className="sidebar-item-menu" ref={menuRef}>
        <button
          className="sidebar-item-menu-trigger"
          onClick={handleMenuClick}
          aria-label="更多操作"
          title="更多操作"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="1"/>
            <circle cx="19" cy="12" r="1"/>
            <circle cx="5" cy="12" r="1"/>
          </svg>
        </button>
        {menuOpen && (
          <div className="sidebar-item-dropdown">
            <button className="sidebar-item-dropdown-item" onClick={startRename}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 21h8"/>
                <path d="m15 5 4 4"/>
                <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>
              </svg>
              重命名
            </button>
            <button className="sidebar-item-dropdown-item" onClick={handlePin}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 17v5"/>
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
              </svg>
              置顶
            </button>
            {onRestore ? (
              <button className="sidebar-item-dropdown-item" onClick={handleRestoreClick}>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
                恢复
              </button>
            ) : (
              <button className="sidebar-item-dropdown-item" onClick={handleArchive}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="1" y="1.5" width="10" height="2.5" rx=".5"/>
                  <path d="M2.5 4v6a1 1 0 001 1h5a1 1 0 001-1V4"/>
                </svg>
                归档
              </button>
            )}
            <button className="sidebar-item-dropdown-item" onClick={handleAnalyze}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 1024 1024">
                <path fill="currentColor" d="M512 119.168c0-49.024 59.264-73.6 93.952-38.976l360.32 360.384a55.04 55.04 0 0 1 0 77.888l-360.32 360.32C571.264 913.536 512 888.96 512 839.936v-167.04c-126.08 8.96-220.096 70.592-284.544 133.568a595.5 595.5 0 0 0-96.96 124.544c-2.048 3.648-3.52 6.4-4.48 8.32l-1.088 1.92-.192.448-2.88 4.672A32 32 0 0 1 64 927.552c0-190.08 40.768-349.568 122.048-462.336C262.464 359.168 373.12 296.768 512 288.576V119.104zm64 200.32a32 32 0 0 1-32 32c-134.08 0-236.288 54.336-306.048 151.168-55.424 76.864-91.328 182.208-104.384 311.744 14.08-17.216 30.4-35.456 49.088-53.76C260.224 684.864 379.776 607.552 544 607.552a32 32 0 0 1 32 32v178.752l338.752-338.752L576 140.8v178.752z"/>
              </svg>
              分享
            </button>
            <div className="sidebar-item-dropdown-divider" />
            <button className="sidebar-item-dropdown-item sidebar-item-dropdown-item-danger" onClick={handleDelete}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 11v6"/>
                <path d="M14 11v6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M3 6h18"/>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              删除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountPopover() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [checking, setChecking] = useState(false);

  const displayName = user?.nickname || user?.username || '未命名用户';
  const initial = (user?.nickname || user?.username || '?').charAt(0).toUpperCase();

  /** 确认退出登录：调后端撤销 token + 清本地 + 跳登录页，并用 TDesign 消息提示反馈 */
  const handleLogout = useCallback(async () => {
    setLogoutOpen(false);
    setOpen(false);
    try {
      await logout();
      MessagePlugin.success('已登出');
    } catch {
      MessagePlugin.error('退出失败，请重试');
    }
  }, [logout]);

  /** 检查更新：真实请求后端 /health 获取版本号 */
  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    try {
      const health = await getHealth();
      setVersion(health.version);
      setUpdateOpen(true);
    } catch {
      MessagePlugin.error('检查更新失败，请稍后重试');
    } finally {
      setChecking(false);
    }
  }, []);

  // 点击菜单项后关闭弹层并执行对应动作
  const runAndClose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  // 弹层内容（由 TDesign Popup 负责定位、点击外部关闭与动画）
  const menu = (
    <div className="account-popover">
      <button
        className="account-popover-item"
        onClick={() => {
          setOpen(false);
          setSettingsOpen(true);
        }}
      >
        <SettingIcon />
        设置
      </button>

      <div className="account-popover-row">
        <div className="account-popover-item account-popover-item-static">
          <ModeLightIcon />
          外观
        </div>
        <Radio.Group
          className="popover-theme-toggle"
          size="small"
          variant="default-filled"
          value={theme}
          onChange={(val) => setTheme(val as 'light' | 'dark')}
        >
          <Radio.Button value="light">
            <ModeLightIcon /> 浅色
          </Radio.Button>
          <Radio.Button value="dark">
            <ModeDarkIcon /> 深色
          </Radio.Button>
        </Radio.Group>
      </div>

      <button className="account-popover-item" onClick={runAndClose(() => navigate('/help'))}>
        <HelpCircleIcon />
        帮助与反馈
      </button>

      <button
        className="account-popover-item"
        onClick={runAndClose(() => void handleCheckUpdate())}
        disabled={checking}
      >
        <RefreshIcon />
        {checking ? '检查中…' : '检查更新'}
      </button>

      <div className="account-popover-divider" />

      <button
        className="account-popover-item account-popover-logout"
        onClick={runAndClose(() => setLogoutOpen(true))}
      >
        <LogoutIcon />
        退出登录
      </button>
    </div>
  );

  return (
    <>
      <Popup
        content={menu}
        trigger="click"
        placement="top-left"
        visible={open}
        onVisibleChange={setOpen}
        showArrow={false}
        destroyOnClose
        overlayClassName="account-popover-overlay"
      >
        <div
          className="sidebar-account-trigger"
          role="button"
          tabIndex={0}
          aria-label="账号菜单"
          aria-haspopup="true"
          aria-expanded={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen((prev) => !prev);
            }
          }}
        >
          <Avatar className="sidebar-avatar" size="32px" image={user?.avatar || undefined}>
            {initial}
          </Avatar>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{displayName}</div>
            <div className="sidebar-user-plan">@{user?.username || '—'}</div>
          </div>
        </div>
      </Popup>

      <Dialog
        visible={logoutOpen}
        header="退出登录"
        body="确认退出当前账号吗？"
        confirmBtn="确认退出"
        cancelBtn="取消"
        onConfirm={() => void handleLogout()}
        onCancel={() => setLogoutOpen(false)}
        onClose={() => setLogoutOpen(false)}
        destroyOnClose
      />

      <Dialog
        visible={updateOpen}
        header="检查更新"
        confirmBtn="知道了"
        cancelBtn={null}
        onConfirm={() => setUpdateOpen(false)}
        onClose={() => setUpdateOpen(false)}
        destroyOnClose
      >
        <div className="update-info">
          <div className="update-row">
            <span className="update-label">当前版本</span>
            <b className="update-version">v{version}</b>
          </div>
          <div className="update-status">
            {version ? '已是最新版本 🎉' : '暂未获取到版本信息'}
          </div>
        </div>
      </Dialog>

      <SettingsDialog visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const mode = useMode();
  const {
    conversations, activeId, activate, create, remove, updateTitle,
    fetchSessions, fetchMoreSessions, loading, error, total, hasMore,
    archivedView, setArchivedView, restoreFromArchive,
  } = useConversationStore();
  const { showToast } = useToast();
  const navigate = useNavigate();

  /** 待删除的会话 ID，非 null 时显示确认弹框 */
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 挂载时从后端拉取会话列表
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // 无限滚动：列表底部出现时加载下一页
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || loading) return;
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchMoreSessions();
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, fetchMoreSessions]);

  /** 切换归档视图 */
  const handleToggleArchived = useCallback(() => {
    setArchivedView(!archivedView);
  }, [archivedView, setArchivedView]);

  /** 恢复归档会话（将 isArchived 置 false） */
  const handleRestore = useCallback(async (id: string) => {
    try {
      await restoreFromArchive(id);
      MessagePlugin.success('已恢复到活跃会话');
    } catch (e: any) {
      MessagePlugin.error(`恢复失败: ${e?.message || '未知错误'}`);
    }
  }, [restoreFromArchive]);

  const handleSwitchMode = useCallback((m: AppMode) => {
    navigate(`/${m}`);
    // 移动端选择模式后自动关闭侧边栏（覆盖层模式），桌面端保持不变
    if (window.innerWidth <= 768 && sidebarOpen) toggleSidebar();
  }, [navigate, sidebarOpen, toggleSidebar]);

  const handleNewConversation = useCallback(async () => {
    try {
      await create(mode);
      navigate(`/${mode}`);
      showToast('已创建新会话');
    } catch {
      showToast('创建会话失败');
    }
  }, [create, mode, navigate, showToast]);

  const handleSelectConversation = useCallback((conv: Conversation) => {
    activate(conv.id);
    navigate(`/${conv.mode}`);
  }, [activate, navigate]);

  /** 点击删除按钮：打开确认弹框 */
  const handleDelete = useCallback((id: string) => {
    setDeleteTargetId(id);
  }, []);

  /** 归档会话（不删除数据，隐藏到归档列表） */
  const handleArchiveSession = useCallback(async (id: string) => {
    const wasActive = id === activeId;
    try {
      await remove(id, true);
      if (wasActive) {
        // P2-2 修复：store 的 remove 已自动切换到相邻会话，这里只需导航到对应模式
        const state = useConversationStore.getState();
        if (state.activeId) {
          const conv = state.conversations.find((c) => c.id === state.activeId);
          if (conv) navigate(`/${conv.mode}`);
        }
      }
      MessagePlugin.success('已归档');
    } catch {
      MessagePlugin.error('归档失败');
    }
  }, [activeId, remove, navigate]);

  /** 确认删除：从数据库物理删除 */
  const confirmDelete = useCallback(async () => {
    const id = deleteTargetId;
    if (!id) return;
    const wasActive = id === activeId;
    setDeleting(true);
    try {
      await remove(id, false);
      if (wasActive) {
        // P2-2 修复：store 的 remove 已自动切换到相邻会话，这里只需导航到对应模式
        const state = useConversationStore.getState();
        if (state.activeId) {
          const conv = state.conversations.find((c) => c.id === state.activeId);
          if (conv) navigate(`/${conv.mode}`);
        }
      }
      MessagePlugin.success('已删除');
    } catch (e: any) {
      MessagePlugin.error(`删除失败: ${e?.message || e?.code || '未知错误'}`);
    } finally {
      setDeleting(false);
      setDeleteTargetId(null);
    }
  }, [deleteTargetId, activeId, remove, navigate]);

  /** 取消删除：关闭弹框 */
  const cancelDelete = useCallback(() => {
    if (!deleting) {
      setDeleteTargetId(null);
    }
  }, [deleting]);

  const grouped = conversations.reduce<Record<string, Conversation[]>>((acc, c) => {
    (acc[c.group] ??= []).push(c);
    return acc;
  }, {});

  return (
    <>
      <div
        className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={toggleSidebar}
      />
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">创</div>
            <span className="sidebar-logo-text">创路Agent</span>
            <button
              className="sidebar-collapse-btn"
              onClick={toggleSidebar}
              title={sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
              aria-label={sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
            >
              {sidebarOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2"/>
                  <path d="M9 3v18"/>
                  <path d="m16 15-3-3 3-3"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2"/>
                  <path d="M9 3v18"/>
                  <path d="m14 9 3 3-3 3"/>
                </svg>
              )}
            </button>
          </div>
          <div className="sidebar-mode-switcher" role="tablist" aria-label="模式切换">
            {(['chat', 'pro', 'task'] as const).map((m) => (
              <button
                key={m}
                className={`sidebar-mode-btn${mode === m ? ' active' : ''}`}
                role="tab"
                aria-selected={mode === m}
                title={{ chat: '对话模式', pro: '分析模式', task: '任务模式' }[m]}
                onClick={() => handleSwitchMode(m)}
              >
                {m === 'chat' && (
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <path d="M2 3h10a1 1 0 011 1v5a1 1 0 01-1 1H5l-3 2V4a1 1 0 011-1z"/>
                  </svg>
                )}
                {m === 'pro' && (
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <path d="M2 2h4v4H2zM8 2h4v4H8zM2 8h4v4H2zM8 8h4v4H8z"/>
                  </svg>
                )}
                {m === 'task' && (
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="1" y="1" width="12" height="12" rx="2"/>
                    <path d="M4 5h6M4 7h4M4 9h5"/>
                  </svg>
                )}
                {{ chat: '对话', pro: '分析', task: '任务' }[m]}
              </button>
            ))}
          </div>
          <button className="btn-new-chat" onClick={handleNewConversation} title="新建会话">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="8" y1="3" x2="8" y2="13"/>
              <line x1="3" y1="8" x2="13" y2="8"/>
            </svg>
            新建会话
          </button>
          {/* 归档视图切换：在活跃/归档会话列表之间切换 */}
          <button
            className={`btn-archive-toggle${archivedView ? ' active' : ''}`}
            onClick={handleToggleArchived}
            title={archivedView ? '返回活跃会话' : '查看归档会话'}
            aria-pressed={archivedView}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="1.5" width="14" height="3" rx="0.5"/>
              <path d="M2.5 5v8.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V5"/>
              <path d="M6 8h4"/>
            </svg>
            {archivedView ? '返回活跃会话' : '归档会话'}
          </button>
        </div>

        <div className="sidebar-list">
          {/* 首次加载骨架屏 */}
          {loading && conversations.length === 0 && (
            <div className="sidebar-list-status">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="sidebar-skeleton-item">
                  <div className="skeleton-line skeleton-line-title" />
                  <div className="skeleton-line skeleton-line-meta" />
                </div>
              ))}
            </div>
          )}

          {/* 首次加载失败
            - 401 错误（token 已被清除）：引导用户重新登录
            - 其他错误：重试加载 */}
          {!loading && error && conversations.length === 0 && (
            <div className="sidebar-list-status sidebar-list-error">
              <p className="sidebar-status-text">{error}</p>
              {error.includes('未认证') || error.includes('Token') ? (
                <button className="sidebar-retry-btn" onClick={() => navigate('/auth/login')}>去登录</button>
              ) : (
                <button className="sidebar-retry-btn" onClick={() => fetchSessions()}>重试</button>
              )}
            </div>
          )}

          {/* 空列表 */}
          {!loading && !error && conversations.length === 0 && (
            <div className="sidebar-list-status sidebar-list-empty">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
              <p className="sidebar-status-text">暂无会话</p>
            </div>
          )}

          {/* 会话列表 */}
          {conversations.length > 0 && (
            <>
              {Object.entries(grouped).map(([group, items]) => (
                <React.Fragment key={group}>
                  <div className="sidebar-group-label">{group}</div>
                  {items.map(item => (
                    <SidebarItem
                      key={item.id}
                      conv={item}
                      isActive={item.id === activeId}
                      onSelect={() => handleSelectConversation(item)}
                      onDelete={() => handleDelete(item.id)}
                      onArchive={() => handleArchiveSession(item.id)}
                      onRename={(title) => { updateTitle(item.id, title).catch(() => showToast('重命名失败')); }}
                      onRestore={archivedView ? () => handleRestore(item.id) : undefined}
                    />
                  ))}
                </React.Fragment>
              ))}
              {/* 无限滚动哨兵 */}
              <div ref={loadMoreRef} className="sidebar-load-more">
                {loading && <span className="sidebar-load-more-text">加载中...</span>}
              </div>
            </>
          )}
        </div>

        <div className="sidebar-footer">
          <AccountPopover />
        </div>
      </aside>

      {/* 删除确认弹框 */}
      <Dialog
        visible={deleteTargetId !== null}
        header="确认删除"
        body="确定要删除该会话吗？删除后数据不可恢复。"
        theme="danger"
        confirmBtn={{ content: '确认删除', loading: deleting, theme: 'danger' }}
        cancelBtn="取消"
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        onClose={cancelDelete}
        destroyOnClose
      />
    </>
  );
}