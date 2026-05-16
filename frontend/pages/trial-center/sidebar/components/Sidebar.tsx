import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelRightClose, SquareCheckBig, Trash2, MessageSquareMore, MoreHorizontal, Share2, Pencil, Flag, Pin } from 'lucide-react';
import chatConversationService, { type ConversationItem } from '../../../../services/chatConversationService';

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onNewChat: () => void;
  isGenerating: boolean;
  currentConversationId: number | null;
  onSwitchConversation: (id: number) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  onNewChat,
  isGenerating,
  currentConversationId,
  onSwitchConversation,
}) => {
  const navigate = useNavigate();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (openMenuId !== null) {
        if (!target.closest('.sidebar-conversation-menu') && !target.closest('.sidebar-conversation-more-btn')) {
          setOpenMenuId(null);
        }
      }
      if (isUserMenuOpen) {
        if (!target.closest('.sidebar-user-menu') && !target.closest('.user-info')) {
          setIsUserMenuOpen(false);
        }
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openMenuId, isUserMenuOpen]);

  const fetchConversations = useCallback(async () => {
    try {
      const list = await chatConversationService.getConversations();
      setConversations(list);
    } catch (e) {
      console.error('获取会话列表失败:', e);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    fetchConversations();
  }, [currentConversationId, fetchConversations]);

  const handleMoreClick = useCallback((e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setOpenMenuId(prev => prev === id ? null : id);
  }, []);

  const handleMenuAction = useCallback((e: React.MouseEvent, action: string, id: number) => {
    e.stopPropagation();
    setOpenMenuId(null);
    switch (action) {
      case 'delete':
        setDeleteConfirmId(id);
        break;
      case 'rename':
        break;
      case 'report':
        break;
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    if (deleteConfirmId === null || deletingId !== null) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    setDeletingId(id);
    try {
      await chatConversationService.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (id === currentConversationId) {
        onNewChat();
      }
    } catch (e) {
      console.error('删除会话失败:', e);
    } finally {
      setDeletingId(null);
    }
  }, [deleteConfirmId, deletingId, currentConversationId, onNewChat]);

  return (
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-content">
        <div className="sidebar-header">
          <div className="sidebar-logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <div className="logo-circle">IAC</div>
            <span className="logo-text">IAC Incubator</span>
          </div>
          <div className="sidebar-header-actions">
            <button
              className="sidebar-action-btn"
              title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
              onClick={onToggleCollapse}
            >
              {isCollapsed ? <PanelRightClose size={16} strokeWidth={2} /> : <PanelLeftClose size={16} strokeWidth={2} />}
            </button>
            <button className="sidebar-action-btn" title="新建任务">
              <SquareCheckBig size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        <button className="new-task-btn-sidebar" onClick={onNewChat} disabled={isGenerating}>
          <SquareCheckBig size={16} strokeWidth={2} />
          新建任务
        </button>

        {!isCollapsed && (
          <div className="sidebar-conversations">
            <div className="sidebar-conversations-title">历史会话</div>
            <div className="sidebar-conversations-list">
              {conversations.length === 0 && (
                <div className="sidebar-conversations-empty">暂无历史会话</div>
              )}
              {conversations.map((conv, index) => (
                <div
                  key={conv.id}
                  className={`sidebar-conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
                  onClick={() => onSwitchConversation(conv.id)}
                >
                  <MessageSquareMore size={14} className="sidebar-conversation-icon" />
                  <span className="sidebar-conversation-title">{conv.title}</span>
                  {index === 0 && <Pin size={14} className="sidebar-conversation-pin" />}
                  <button
                    className="sidebar-conversation-more-btn"
                    onClick={(e) => handleMoreClick(e, conv.id)}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {openMenuId === conv.id && (
                    <div className="sidebar-conversation-menu">
                      <div className="sidebar-conversation-menu-item disabled">
                        <Share2 size={14} /> 分享
                      </div>
                      <div className="sidebar-conversation-menu-item" onClick={(e) => handleMenuAction(e, 'rename', conv.id)}>
                        <Pencil size={14} /> 重命名
                      </div>
                      <div className="sidebar-conversation-menu-item" onClick={(e) => handleMenuAction(e, 'report', conv.id)}>
                        <Flag size={14} /> 举报
                      </div>
                      <div className="sidebar-conversation-menu-divider" />
                      <div className="sidebar-conversation-menu-item danger" onClick={(e) => handleMenuAction(e, 'delete', conv.id)}>
                        <Trash2 size={14} /> 删除
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="sidebar-footer">
          <div
            className="user-info"
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            style={{ cursor: 'pointer' }}
          >
            <div className="user-avatar-sidebar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="8" r="4"/>
                <path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8"/>
              </svg>
            </div>
            <span className="user-name">admin</span>
          </div>
          {isUserMenuOpen && (
            <div className="sidebar-user-menu">
              <div className="sidebar-user-menu-header">
                <div className="sidebar-user-avatar-large">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="8" r="4"/>
                    <path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8"/>
                  </svg>
                </div>
                <div className="sidebar-user-menu-info">
                  <div className="sidebar-user-menu-name">xueyb</div>
                </div>
              </div>
              <div className="sidebar-user-menu-divider"></div>
              <div className="sidebar-user-menu-item">
                <span>管理账号</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
              </div>
              <div className="sidebar-user-menu-item">
                <span>语言</span>
                <div className="sidebar-user-menu-item-right">
                  <span>简体中文</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
              <div className="sidebar-user-menu-item">
                <span>主题</span>
                <div className="sidebar-user-menu-item-right">
                  <span>亮色</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
              <div className="sidebar-user-menu-item">
                <span>设置</span>
              </div>
              <div className="sidebar-user-menu-divider"></div>
              <div className="sidebar-user-menu-item logout">
                <span>退出登录</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {deleteConfirmId !== null && (
        <div className="sidebar-delete-confirm-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="sidebar-delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-delete-confirm-title">删除后，该对话将不可恢复</div>
            <div className="sidebar-delete-confirm-desc">由该对话生成的分享链接也将失效</div>
            <div className="sidebar-delete-confirm-actions">
              <button className="sidebar-delete-confirm-btn cancel" onClick={() => setDeleteConfirmId(null)}>取消</button>
              <button className="sidebar-delete-confirm-btn danger" onClick={confirmDelete}>删除该对话</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
