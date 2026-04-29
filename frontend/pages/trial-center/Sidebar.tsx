import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelRightClose, SquareCheckBig, Trash2, MessageSquare } from 'lucide-react';
import chatConversationService, { type ConversationItem } from '../../services/chatConversationService';

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

  // 当前会话变化时刷新列表（新建、消息更新等场景）
  useEffect(() => {
    fetchConversations();
  }, [currentConversationId, fetchConversations]);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (deletingId !== null) return;
    setDeletingId(id);
    try {
      await chatConversationService.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      // 如果删除的是当前会话，触发新建
      if (id === currentConversationId) {
        onNewChat();
      }
    } catch (e) {
      console.error('删除会话失败:', e);
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, currentConversationId, onNewChat]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

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

        {/* 历史会话列表 */}
        {!isCollapsed && (
          <div className="sidebar-conversations">
            <div className="sidebar-conversations-title">历史会话</div>
            <div className="sidebar-conversations-list">
              {conversations.length === 0 && (
                <div className="sidebar-conversations-empty">暂无历史会话</div>
              )}
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  className={`sidebar-conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
                  onClick={() => onSwitchConversation(conv.id)}
                >
                  <MessageSquare size={14} className="sidebar-conversation-icon" />
                  <div className="sidebar-conversation-info">
                    <div className="sidebar-conversation-title">{conv.title}</div>
                    <div className="sidebar-conversation-meta">
                      {formatDate(conv.updatedAt)} · {conv._count.messages}条消息
                    </div>
                  </div>
                  <button
                    className="sidebar-conversation-delete"
                    onClick={(e) => handleDelete(e, conv.id)}
                    title="删除会话"
                    disabled={deletingId === conv.id}
                  >
                    <Trash2 size={12} />
                  </button>
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
    </aside>
  );
};

export default Sidebar;
