/**
 * 应用侧边栏（拆为三件）
 * - Sidebar.tsx：壳层、模式切换、会话列表、无限滚动、归档视图、删除确认
 * - SidebarItem.tsx：单条会话 + 行内菜单
 * - AccountPopover.tsx：底部账号弹层/个人中心与设置入口（均指向设置框）
 * 业务逻辑（重命名/归档/恢复/无限滚动/骨架屏）保持不变；
 * 对话框/提示/toast/图标统一为 shadcn/sonner/lucide。
 */
import { useCallback, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  SquarePen,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../../store/appStore';
import {
  useConversationStore,
  type Conversation,
} from '../../store/conversationStore';
import { useMode } from '../../hooks/useMode';
import type { AppMode } from '../../types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SidebarItem } from './SidebarItem';
import { AccountPopover } from './AccountPopover';
import { ConfirmDialog } from './ConfirmDialog';
import '../../styles/tokens.css';
import './sidebar.css';

const MODES = [
  { id: 'chat' as const, label: '对话', hint: '对话模式', icon: MessageSquare },
  { id: 'pro' as const, label: '分析', hint: '分析模式', icon: LayoutGrid },
  { id: 'task' as const, label: '任务', hint: '任务模式', icon: ListChecks },
];

export function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const mode = useMode();
  const {
    conversations,
    activeId,
    activate,
    create,
    remove,
    updateTitle,
    fetchSessions,
    fetchMoreSessions,
    loading,
    error,
    hasMore,
    archivedView,
    setArchivedView,
    restoreFromArchive,
  } = useConversationStore();
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
  const handleRestore = useCallback(
    async (id: string) => {
      try {
        await restoreFromArchive(id);
        toast.success('已恢复到活跃会话');
      } catch (e) {
        toast.error(`恢复失败: ${(e as Error)?.message || '未知错误'}`);
      }
    },
    [restoreFromArchive],
  );

  const handleSwitchMode = useCallback(
    (m: AppMode) => {
      navigate(`/${m}`);
      // 移动端选择模式后自动关闭侧边栏（覆盖层模式），桌面端保持不变
      if (window.innerWidth <= 768 && sidebarOpen) toggleSidebar();
    },
    [navigate, sidebarOpen, toggleSidebar],
  );

  /** 判断当前是否处于"新建会话"状态：默认标题"新会话"且无预览内容 */
  const isActiveConversationNew = useCallback(() => {
    const state = useConversationStore.getState();
    const active = state.conversations.find((c) => c.id === state.activeId);
    return !!active && active.title === '新会话' && !active.preview;
  }, []);

  const handleNewConversation = useCallback(async () => {
    if (isActiveConversationNew()) {
      toast.success('已是最新的对话', { duration: 3000 });
      return;
    }
    try {
      await create(mode);
      navigate(`/${mode}`);
      toast.info('已创建新会话');
    } catch {
      toast.info('创建会话失败');
    }
  }, [create, mode, navigate, isActiveConversationNew]);

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      activate(conv.id);
      navigate(`/${conv.mode}`);
    },
    [activate, navigate],
  );

  /** 归档会话（不删除数据，隐藏到归档列表） */
  const handleArchiveSession = useCallback(
    async (id: string) => {
      const wasActive = id === activeId;
      try {
        await remove(id, true);
        if (wasActive) {
          // store 的 remove 已自动切换到相邻会话，这里只需导航到对应模式
          const state = useConversationStore.getState();
          if (state.activeId) {
            const conv = state.conversations.find(
              (c) => c.id === state.activeId,
            );
            if (conv) navigate(`/${conv.mode}`);
          }
        }
        toast.success('已归档');
      } catch {
        toast.error('归档失败');
      }
    },
    [activeId, remove, navigate],
  );

  /** 确认删除：从数据库物理删除 */
  const confirmDelete = useCallback(async () => {
    const id = deleteTargetId;
    if (!id) return;
    const wasActive = id === activeId;
    setDeleting(true);
    try {
      await remove(id, false);
      if (wasActive) {
        const state = useConversationStore.getState();
        if (state.activeId) {
          const conv = state.conversations.find(
            (c) => c.id === state.activeId,
          );
          if (conv) navigate(`/${conv.mode}`);
        }
      }
      toast.success('已删除');
    } catch (e) {
      toast.error(
        `删除失败: ${(e as { message?: string; code?: number })?.message || (e as { code?: number })?.code || '未知错误'}`,
      );
    } finally {
      setDeleting(false);
      setDeleteTargetId(null);
    }
  }, [deleteTargetId, activeId, remove, navigate]);

  const grouped = conversations.reduce<Record<string, Conversation[]>>(
    (acc, c) => {
      (acc[c.group] ??= []).push(c);
      return acc;
    },
    {},
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={toggleSidebar}
      />
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">创</div>
            <span className="sidebar-logo-text">创路Agent</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="sidebar-collapse-btn"
                  onClick={toggleSidebar}
                  aria-label={sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose size={18} />
                  ) : (
                    <PanelLeftOpen size={18} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="sidebar-mode-switcher" role="tablist" aria-label="模式切换">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <Tooltip key={m.id}>
                  <TooltipTrigger asChild>
                    <button
                      className={`sidebar-mode-btn${mode === m.id ? ' active' : ''}`}
                      role="tab"
                      aria-selected={mode === m.id}
                      onClick={() => handleSwitchMode(m.id)}
                    >
                      <Icon style={{ width: 14, height: 14 }} strokeWidth={1.5} />
                      {m.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{m.hint}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <button className="btn-new-chat" onClick={handleNewConversation}>
                <SquarePen size={16} strokeWidth={1.5} />
                新建会话
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">新建会话</TooltipContent>
          </Tooltip>

          {/* 归档视图切换：在活跃/归档会话列表之间切换 */}
          <button
            className={`btn-archive-toggle${archivedView ? ' active' : ''}`}
            onClick={handleToggleArchived}
            aria-pressed={archivedView}
          >
            <Archive size={16} strokeWidth={1.5} />
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

          {/* 首次加载失败：401 引导重新登录，其他错误可重试 */}
          {!loading && error && conversations.length === 0 && (
            <div className="sidebar-list-status sidebar-list-error">
              <p className="sidebar-status-text">{error}</p>
              {error.includes('未认证') || error.includes('Token') ? (
                <button
                  className="sidebar-retry-btn"
                  onClick={() => navigate('/auth/login')}
                >
                  去登录
                </button>
              ) : (
                <button
                  className="sidebar-retry-btn"
                  onClick={() => fetchSessions()}
                >
                  重试
                </button>
              )}
            </div>
          )}

          {/* 空列表 */}
          {!loading && !error && conversations.length === 0 && (
            <div className="sidebar-list-status sidebar-list-empty">
              <MessageSquare
                size={28}
                strokeWidth={1.2}
                style={{ opacity: 0.3 }}
              />
              <p className="sidebar-status-text">暂无会话</p>
            </div>
          )}

          {/* 会话列表 */}
          {conversations.length > 0 && (
            <>
              {Object.entries(grouped).map(([group, items]) => (
                <div key={group}>
                  <div className="sidebar-group-label">{group}</div>
                  {items.map((item) => (
                    <SidebarItem
                      key={item.id}
                      conv={item}
                      isActive={item.id === activeId}
                      onSelect={() => handleSelectConversation(item)}
                      onDelete={() => setDeleteTargetId(item.id)}
                      onArchive={() => handleArchiveSession(item.id)}
                      onRename={(title) => {
                        updateTitle(item.id, title).catch(() =>
                          toast.info('重命名失败'),
                        );
                      }}
                      onRestore={
                        archivedView
                          ? () => handleRestore(item.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              ))}
              {/* 无限滚动哨兵 */}
              <div ref={loadMoreRef} className="sidebar-load-more">
                {loading && (
                  <span className="sidebar-load-more-text">加载中...</span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="sidebar-footer">
          <AccountPopover />
        </div>
      </aside>

      {/* 删除确认弹框 */}
      <ConfirmDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTargetId(null);
        }}
        title="确认删除"
        description="确定要删除该会话吗？删除后数据不可恢复。"
        confirmText="确认删除"
        danger
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </TooltipProvider>
  );
}
