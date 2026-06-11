import { useMemo, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelRightClose, SquareCheckBig, Trash2, MessageSquareMore, MoreHorizontal, PencilLine, Pin, PinOff, AlertTriangle } from 'lucide-react';
import chatConversationService, { type SessionItem } from '../../../../services/chatConversationService';

const ShareIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} fill="currentColor" viewBox="0 0 1024 1024">
    <path d="M512 119.168c0-49.024 59.264-73.6 93.952-38.976l360.32 360.384a55.04 55.04 0 0 1 0 77.888l-360.32 360.32C571.264 913.536 512 888.96 512 839.936v-167.04c-126.08 8.96-220.096 70.592-284.544 133.568a595.5 595.5 0 0 0-96.96 124.544c-2.048 3.648-3.52 6.4-4.48 8.32l-1.088 1.92-.192.448-2.88 4.672A32 32 0 0 1 64 927.552c0-190.08 40.768-349.568 122.048-462.336C262.464 359.168 373.12 296.768 512 288.576V119.104zm64 200.32a32 32 0 0 1-32 32c-134.08 0-236.288 54.336-306.048 151.168-55.424 76.864-91.328 182.208-104.384 311.744 14.08-17.216 30.4-35.456 49.088-53.76C260.224 684.864 379.776 607.552 544 607.552a32 32 0 0 1 32 32v178.752l338.752-338.752L576 140.8v178.752z"/>
  </svg>
);

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onNewChat: () => void;
  isGenerating: boolean;
  currentConversationId: string | null;
  onSwitchConversation: (id: string) => void;
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
  const [conversations, setConversations] = useState<SessionItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

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
      const list = await chatConversationService.getSessions();
      setConversations(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error('获取会话列表失败:', e);
      setConversations([]);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    fetchConversations();
  }, [currentConversationId, fetchConversations]);

  // 去重：确保会话 ID 唯一，避免 React key 重复警告
  const deduplicatedConversations = useMemo(
    () => {
      const seen = new Set<string>()
      return conversations.filter(c => {
        if (seen.has(c.id)) return false
        seen.add(c.id)
        return true
      })
    },
    [conversations],
  )

  const handleMoreClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setOpenMenuId(prev => prev === id ? null : id);
  }, []);

  const handleMenuAction = useCallback((e: React.MouseEvent, action: string, id: string) => {
    e.stopPropagation();
    setOpenMenuId(null);
    switch (action) {
      case 'delete':
        setDeleteConfirmId(id);
        break;
      case 'rename':
        break;
      case 'pin':
        setPinnedIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        break;
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    if (deleteConfirmId === null || deletingId !== null) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    setDeletingId(id);
    try {
      await chatConversationService.deleteSession(id);
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
            <div className="logo-circle">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="25" height="25">
                <circle cx="16" cy="16" r="14" fill="#646cff"/>
                <text x="16" y="21" fontSize="14" textAnchor="middle" fill="white" fontFamily="Arial">IAC</text>
              </svg>
            </div>
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
              {deduplicatedConversations.length === 0 && (
                <div className="sidebar-conversations-empty">暂无历史会话</div>
              )}
              {deduplicatedConversations.map((conv, index) => (
                <div
                  key={conv.id}
                  className={`sidebar-conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
                  onClick={() => onSwitchConversation(conv.id)}
                >
                  <MessageSquareMore size={14} className="sidebar-conversation-icon" />
                  <span className="sidebar-conversation-title">{conv.title}</span>
                  <button
                    className="sidebar-conversation-more-btn"
                    onClick={(e) => handleMoreClick(e, conv.id)}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {openMenuId === conv.id && (
                    <div className="sidebar-conversation-menu">
                      <div className="sidebar-conversation-menu-item" onClick={(e) => handleMenuAction(e, 'pin', conv.id)}>
                        {pinnedIds.has(conv.id) ? (
                          <><PinOff size={18} strokeWidth={1.8} /> 取消置顶</>
                        ) : (
                          <><Pin size={18} strokeWidth={1.8} /> 置顶</>
                        )}
                      </div>
                      <div className="sidebar-conversation-menu-item disabled">
                        <ShareIcon /> 分享
                      </div>
                      <div className="sidebar-conversation-menu-item" onClick={(e) => handleMenuAction(e, 'rename', conv.id)}>
                        <PencilLine size={18} strokeWidth={1.8} /> 重命名
                      </div>
                      <div className="sidebar-conversation-menu-item" onClick={(e) => handleMenuAction(e, 'report', conv.id)}>
                        <AlertTriangle size={18} strokeWidth={1.8} /> 举报
                      </div>
                      <div className="sidebar-conversation-menu-item danger" onClick={(e) => handleMenuAction(e, 'delete', conv.id)}>
                        <Trash2 size={18} strokeWidth={1.8} /> 删除
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
