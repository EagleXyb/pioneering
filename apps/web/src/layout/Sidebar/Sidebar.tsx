import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAppStore } from '../../store/appStore';
import { useConversationStore, type Conversation } from '../../store/conversationStore';
import { useTheme } from '../../store/themeContext';
import { useToast } from '../../store/toastContext';
import type { AppMode } from '../../types';
import '../../styles/tokens.css';
import './sidebar.css';

function SidebarItem({ conv, isActive, onSelect, onDelete }: {
  conv: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const modeLabels: Record<string, string> = { chat: '对话', pro: '分析', task: '任务' };
  return (
    <div
      className={`sidebar-item${isActive ? ' active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(); }}
    >
      <div className="sidebar-item-inner">
        <div className="sidebar-item-title">{conv.title}</div>
        <div className="sidebar-item-meta">
          <span className="sidebar-item-mode-tag">{modeLabels[conv.mode]}</span>
          {conv.preview && <span className="sidebar-item-preview">{conv.preview}</span>}
        </div>
      </div>
      <button
        className="sidebar-item-delete"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label="删除会话"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 4l6 6M10 4l-6 6"/>
        </svg>
      </button>
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
    conversations, activeId, activate, create, remove,
  } = useConversationStore();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSwitchMode = useCallback((m: AppMode) => {
    setMode(m);
    navigate(`/${m}`);
    if (sidebarOpen) toggleSidebar();
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
          </div>
          <div className="sidebar-mode-switcher" role="tablist" aria-label="模式切换">
            {(['chat', 'pro', 'task'] as const).map((m) => (
              <button
                key={m}
                className={`sidebar-mode-btn${mode === m ? ' active' : ''}`}
                role="tab"
                aria-selected={mode === m}
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
          <button className="btn-new-chat" onClick={handleNewConversation}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="8" y1="3" x2="8" y2="13"/>
              <line x1="3" y1="8" x2="13" y2="8"/>
            </svg>
            新建会话
          </button>
        </div>

        <div className="sidebar-list">
          {Object.entries(grouped).map(([group, items]) => (
            <React.Fragment key={group}>
              <div className="sidebar-group-label">{group}</div>
              {items.map(item => (
                <SidebarItem
                  key={item.id}
                  conv={item}
                  isActive={item.id === activeId}
                  onSelect={() => handleSelectConversation(item)}
                  onDelete={() => { remove(item.id).catch(() => showToast('删除失败')); }}
                />
              ))}
            </React.Fragment>
          ))}
        </div>

        <div className="sidebar-footer">
          <AccountPopover />
        </div>
      </aside>
    </>
  );
}