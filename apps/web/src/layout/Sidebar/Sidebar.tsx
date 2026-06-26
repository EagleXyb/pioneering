import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from 'tdesign-react';
import { useAppStore } from '../../store/appStore';
import { useConversationStore, type Conversation } from '../../store/conversationStore';
import { useTheme } from '../../store/themeContext';
import { useToast } from '../../store/toastContext';
import type { AppMode } from '../../types';
import '../../styles/tokens.css';
import './sidebar.css';

function SidebarItem({ conv, isActive, onSelect, onDelete, onRename }: {
  conv: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conv.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    // TODO: 归档功能
  };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    // TODO: 置顶功能
  };

  const handleAnalyze = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    // TODO: 分析功能
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
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="3" r="1.2"/>
            <circle cx="7" cy="7" r="1.2"/>
            <circle cx="7" cy="11" r="1.2"/>
          </svg>
        </button>
        {menuOpen && (
          <div className="sidebar-item-dropdown">
            <button className="sidebar-item-dropdown-item" onClick={startRename}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z"/>
              </svg>
              重命名
            </button>
            <button className="sidebar-item-dropdown-item" onClick={handlePin}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6.5 1.5L9 4l-5 5.5L1 10l.5-3L6.5 1.5z"/>
              </svg>
              置顶
            </button>
            <button className="sidebar-item-dropdown-item" onClick={handleArchive}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="1.5" width="10" height="2.5" rx=".5"/>
                <path d="M2.5 4v6a1 1 0 001 1h5a1 1 0 001-1V4"/>
              </svg>
              归档
            </button>
            <button className="sidebar-item-dropdown-item" onClick={handleAnalyze}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1.5" y="1.5" width="3" height="3" rx=".5"/>
                <rect x="7.5" y="1.5" width="3" height="3" rx=".5"/>
                <rect x="1.5" y="7.5" width="3" height="3" rx=".5"/>
                <rect x="7.5" y="7.5" width="3" height="3" rx=".5"/>
              </svg>
              分析
            </button>
            <div className="sidebar-item-dropdown-divider" />
            <button className="sidebar-item-dropdown-item sidebar-item-dropdown-item-danger" onClick={handleDelete}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 4l6 6M10 4l-6 6"/>
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
  const { showToast } = useToast();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [open]);

  return (
    <div className="sidebar-account" ref={ref}>
      <div
        className="sidebar-account-trigger"
        role="button"
        tabIndex={0}
        aria-label="账号菜单"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        onKeyDown={(e) => { if (e.key === 'Enter') setOpen(prev => !prev); }}
      >
        <div className="sidebar-avatar">李</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">李总</div>
          <div className="sidebar-user-plan">专业版</div>
        </div>
      </div>

      {open && (
        <div className="account-popover">
          <button className="account-popover-item" onClick={() => { setOpen(false); showToast('设置页面'); }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8.3 2.2a1 1 0 00-1.6 0l-.9 1.4a1 1 0 01-.7.5l-1.7.3a1 1 0 00-.6 1.5l1 1.5a1 1 0 010 .9l-1 1.5a1 1 0 00.6 1.5l1.7.3a1 1 0 01.7.5l.9 1.4a1 1 0 001.6 0l.9-1.4a1 1 0 01.7-.5l1.7-.3a1 1 0 00.6-1.5l-1-1.5a1 1 0 010-.9l1-1.5a1 1 0 00-.6-1.5l-1.7-.3a1 1 0 01-.7-.5z"/>
              <circle cx="8" cy="8" r="1.5"/>
            </svg>
            设置
          </button>

          <div className="account-popover-row">
            <div className="account-popover-item account-popover-item-static">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7.5" cy="7.5" r="4.5"/>
                <path d="M12 12L14.5 14.5M10.5 4.5A3 3 0 0112 7.5"/>
              </svg>
              外观
            </div>
            <div className="popover-theme-toggle" role="radiogroup" aria-label="主题切换">
              <button
                className={`popover-theme-toggle-opt${theme === 'light' ? ' active' : ''}`}
                role="radio"
                aria-checked={theme === 'light'}
                onClick={() => setTheme('light')}
              >浅色</button>
              <button
                className={`popover-theme-toggle-opt${theme === 'dark' ? ' active' : ''}`}
                role="radio"
                aria-checked={theme === 'dark'}
                onClick={() => setTheme('dark')}
              >深色</button>
            </div>
          </div>

          <button className="account-popover-item" onClick={() => { setOpen(false); showToast('帮助与反馈'); }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6.5"/>
              <path d="M6 6.5c0-1.1.9-2 2-2s2 .9 2 2c0 .8-.5 1.3-1.2 1.7-.5.3-.8.7-.8 1.3M8 12v.5"/>
            </svg>
            帮助与反馈
          </button>

          <button className="account-popover-item" onClick={() => { setOpen(false); showToast('检查更新'); }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6.5"/>
              <path d="M8 4.5v3.5l2 2"/>
              <path d="M13 8h-2M8 13v-2"/>
            </svg>
            检查更新
          </button>

          <div className="account-popover-divider" />

          <button className="account-popover-item account-popover-logout" onClick={() => { setOpen(false); showToast('已登出'); }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3M11 10l3-3-3-3M14 7H6"/>
            </svg>
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { mode, setMode, sidebarOpen, toggleSidebar } = useAppStore();
  const {
    conversations, activeId, activate, create, remove, updateTitle,
    fetchSessions, fetchMoreSessions, loading, error, total,
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
  const hasMore = conversations.length < total;

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

  const handleSwitchMode = useCallback((m: AppMode) => {
    setMode(m);
    navigate(`/${m}`);
    // 移动端选择模式后自动关闭侧边栏（覆盖层模式），桌面端保持不变
    if (window.innerWidth <= 768 && sidebarOpen) toggleSidebar();
  }, [setMode, navigate, sidebarOpen, toggleSidebar]);

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
    setMode(conv.mode);
    navigate(`/${conv.mode}`);
  }, [activate, setMode, navigate]);

  /** 点击删除按钮：打开确认弹框 */
  const handleDelete = useCallback((id: string) => {
    setDeleteTargetId(id);
  }, []);

  /** 确认删除：从数据库物理删除 */
  const confirmDelete = useCallback(async () => {
    const id = deleteTargetId;
    if (!id) return;
    const wasActive = id === activeId;
    setDeleting(true);
    try {
      await remove(id, false);
      if (wasActive) {
        const remaining = useConversationStore.getState().conversations;
        if (remaining.length > 0) {
          const first = remaining[0];
          activate(first.id);
          setMode(first.mode);
          navigate(`/${first.mode}`);
        }
      }
    } catch {
      showToast('删除失败');
    } finally {
      setDeleting(false);
      setDeleteTargetId(null);
    }
  }, [deleteTargetId, activeId, remove, activate, setMode, navigate, showToast]);

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

          {/* 首次加载失败 */}
          {!loading && error && conversations.length === 0 && (
            <div className="sidebar-list-status sidebar-list-error">
              <p className="sidebar-status-text">{error}</p>
              <button className="sidebar-retry-btn" onClick={fetchSessions}>重试</button>
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
                      onRename={(title) => { updateTitle(item.id, title).catch(() => showToast('重命名失败')); }}
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