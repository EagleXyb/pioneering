/**
 * 应用侧边栏
 *
 * 结构：
 *   · 品牌区：Logo + 折叠按钮
 *   · 模式切换：对话 / 分析 / 任务（沿用原分段切换器）
 *   · 操作入口：新建会话 / 插件 · 技能
 *     —— 参照设计稿改为整行样式：选中显示底色，未选中不显示
 *   · 会话区：「分组」（可新建分组 / 折叠）+「最近」（可折叠）
 *   · 底部：账号弹层
 *
 * 子组件：
 *   - SidebarItem.tsx：单条会话 + 行内菜单（含「移动到分组」）
 *   - AccountPopover.tsx：底部账号弹层与设置入口
 *   - GroupNameDialog.tsx：分组新建/重命名对话框
 *   - NavButtons.tsx：侧边栏折叠/展开按钮（与顶栏共用）
 */
import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bookmark,
  ChevronRight,
  CirclePlus,
  Ellipsis,
  Folder,
  FolderPlus,
  PanelLeft,
  PanelRight,
  Pencil,
  Pin,
  Plus,
  Puzzle,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../../store/appStore';
import {
  useConversationStore,
  type Conversation,
} from '../../store/conversationStore';
import {
  useSidebarGroupsStore,
  type SidebarGroup,
} from '../../store/sidebarGroupsStore';
import { useMode } from '../../hooks/useMode';
import type { AppMode } from '../../types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MODE_ICONS } from '@/components/icons/modeIcons';
import { EmptyStateGlyph } from '@/components/icons/emptyStateGlyph';
import { SidebarItem } from './SidebarItem';
import { AccountPopover } from './AccountPopover';
import { ConfirmDialog } from './ConfirmDialog';
import { GroupNameDialog } from './GroupNameDialog';
import '../../styles/tokens.css';
import './sidebar.css';

/** 「分组」区默认最多展示的分组数，超出后折叠为「⋯ 更多分组」 */
const GROUP_PREVIEW_LIMIT = 3;

/** 模式切换器（沿用原样式：对话 / 分析 / 任务 三段） */
const MODES: ReadonlyArray<{ id: AppMode; label: string; hint: string }> = [
  { id: 'chat', label: '对话', hint: '对话模式' },
  { id: 'pro', label: '分析', hint: '分析模式' },
  { id: 'task', label: '任务', hint: '任务模式' },
];

export function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const location = useLocation();
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
    restoreFromArchive,
  } = useConversationStore();
  const {
    groups,
    assignments,
    recentCollapsed,
    groupsCollapsed,
    groupCollapsed,
    createGroup,
    renameGroup,
    removeGroup,
    togglePin,
    assign,
    setRecentCollapsed,
    setGroupsCollapsed,
    toggleGroupCollapsed,
  } = useSidebarGroupsStore();
  const navigate = useNavigate();

  /** 待删除的会话 ID，非 null 时显示确认弹框 */
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** 分组名称对话框：mode=new 时新建，mode=rename 时重命名 */
  const [groupDialog, setGroupDialog] = useState<
    { mode: 'new' } | { mode: 'rename'; group: SidebarGroup } | null
  >(null);
  /** 分组超过 {@link GROUP_PREVIEW_LIMIT} 个时是否已展开「更多分组」 */
  const [showAllGroups, setShowAllGroups] = useState(false);

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

  /** 当前所在路由：对话/分析/任务、插件·技能页 */
  const isChatRoute = !location.pathname.startsWith('/pro') &&
    !location.pathname.startsWith('/task') &&
    !location.pathname.startsWith('/plugins');
  const isPluginsRoute = location.pathname.startsWith('/plugins');

  /** 判断当前是否处于"新建会话"状态：默认标题"新会话"且无预览内容 */
  const isActiveConversationNew = useCallback(() => {
    const state = useConversationStore.getState();
    const active = state.conversations.find((c) => c.id === state.activeId);
    return !!active && active.title === '新会话' && !active.preview;
  }, []);

  /** 切换模式（沿用原逻辑：移动端选择后收起覆盖层） */
  const handleSwitchMode = useCallback(
    (m: AppMode) => {
      navigate(`/${m}`);
      if (window.innerWidth <= 768 && sidebarOpen) toggleSidebar();
    },
    [navigate, sidebarOpen, toggleSidebar],
  );

  /** 新建会话：按当前模式创建 */
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

  /** 在指定分组中新建会话：创建后立即把新会话归入该分组 */
  const handleNewInGroup = useCallback(
    async (group: SidebarGroup) => {
      try {
        await create(mode);
        const state = useConversationStore.getState();
        if (state.activeId) assign(state.activeId, group.id);
        navigate(`/${mode}`);
        toast.success(`已在「${group.name}」中新建会话`);
      } catch {
        toast.error('创建会话失败');
      }
    },
    [assign, create, mode, navigate],
  );

  /** 把会话移动到分组（groupId=null 表示移出分组，回到「最近」） */
  const handleMoveToGroup = useCallback(
    (sessionId: string, groupId: string | null) => {
      assign(sessionId, groupId);
      if (!groupId) {
        toast.success('已移出分组');
        return;
      }
      const target = groups.find((g) => g.id === groupId);
      toast.success(target ? `已移动到「${target.name}」` : '已移动到分组');
    },
    [assign, groups],
  );

  /** 会话按分组拆分：已归组的进对应分组，其余进「最近」 */
  const { groupBuckets, recentConversations } = useMemo(() => {
    const buckets: Record<string, Conversation[]> = {};
    const recent: Conversation[] = [];
    for (const conv of conversations) {
      const gid = assignments[conv.id];
      if (gid && groups.some((g) => g.id === gid)) {
        (buckets[gid] ??= []).push(conv);
      } else {
        recent.push(conv);
      }
    }
    return { groupBuckets: buckets, recentConversations: recent };
  }, [conversations, assignments, groups]);

  /** 置顶分组排在前面（同级内保持创建顺序） */
  const sortedGroups = useMemo(
    () =>
      [...groups].sort(
        (a, b) => Number(!!b.pinned) - Number(!!a.pinned),
      ),
    [groups],
  );

  /** 默认只展示前 N 个分组，其余收进「更多分组」 */
  const visibleGroups = showAllGroups
    ? sortedGroups
    : sortedGroups.slice(0, GROUP_PREVIEW_LIMIT);
  const hasMoreGroups = sortedGroups.length > visibleGroups.length;

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

  /** 单条会话（分组与最近两处共用） */
  const renderConversation = useCallback(
    (conv: Conversation) => (
      <SidebarItem
        key={conv.id}
        conv={conv}
        isActive={conv.id === activeId}
        onSelect={() => handleSelectConversation(conv)}
        onDelete={() => setDeleteTargetId(conv.id)}
        onArchive={() => handleArchiveSession(conv.id)}
        onRename={(title) => {
          updateTitle(conv.id, title).catch(() => toast.info('重命名失败'));
        }}
        onRestore={archivedView ? () => handleRestore(conv.id) : undefined}
        groups={groups}
        currentGroupId={assignments[conv.id]}
        onMoveToGroup={(gid) => handleMoveToGroup(conv.id, gid)}
      />
    ),
    [
      activeId,
      archivedView,
      assignments,
      groups,
      handleArchiveSession,
      handleMoveToGroup,
      handleRestore,
      handleSelectConversation,
      updateTitle,
    ],
  );

  /** 分组名称对话框的提交回调（返回错误文案则保持打开） */
  const handleGroupSubmit = useCallback(
    (name: string): string | null => {
      if (!groupDialog) return null;
      if (groupDialog.mode === 'new') {
        const res = createGroup(name);
        if (!res.ok) return res.message;
        toast.success(res.message);
        return null;
      }
      const res = renameGroup(groupDialog.group.id, name);
      if (!res.ok) return res.message;
      toast.success(res.message);
      return null;
    },
    [createGroup, groupDialog, renameGroup],
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
                    <PanelLeft size={18} strokeWidth={1.75} />
                  ) : (
                    <PanelRight size={18} strokeWidth={1.75} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* 模式切换：对话 / 分析 / 任务（沿用原分段切换器样式） */}
          <div
            className="sidebar-mode-switcher"
            role="tablist"
            aria-label="模式切换"
          >
            {MODES.map((m) => {
              const Icon = MODE_ICONS[m.id];
              return (
                <Tooltip key={m.id}>
                  <TooltipTrigger asChild>
                    <button
                      className={`sidebar-mode-btn${mode === m.id ? ' active' : ''}`}
                      role="tab"
                      aria-selected={mode === m.id}
                      onClick={() => handleSwitchMode(m.id)}
                    >
                      <Icon size={14} />
                      {m.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{m.hint}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {/* 操作入口：选中显示底色，未选中不显示 */}
          <div className="sidebar-actions">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`sidebar-action${isChatRoute ? ' is-active' : ''}`}
                  onClick={handleNewConversation}
                  aria-current={isChatRoute ? 'page' : undefined}
                >
                  <SquarePen size={14} />
                  <span>新建会话</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">新建会话</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`sidebar-action${isPluginsRoute ? ' is-active' : ''}`}
                  onClick={() => navigate('/plugins')}
                  aria-current={isPluginsRoute ? 'page' : undefined}
                >
                  <Puzzle size={14} />
                  <span>插件 · 技能</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">插件 · 技能</TooltipContent>
            </Tooltip>
          </div>
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

          {/* ===== 分组区 ===== */}
          <section className="sidebar-section">
            <div className="sidebar-section__head">
              <button
                className="sidebar-section__toggle"
                onClick={() => setGroupsCollapsed(!groupsCollapsed)}
                aria-expanded={!groupsCollapsed}
              >
                <span>分组</span>
                <ChevronRight
                  size={12}
                  className={`sidebar-section__chevron${
                    groupsCollapsed ? '' : ' is-open'
                  }`}
                />
              </button>
              <button
                className="sidebar-section__action"
                onClick={() => setGroupDialog({ mode: 'new' })}
                aria-label="新建分组"
                title="新建分组"
              >
                <Plus size={14} />
              </button>
            </div>

            {!groupsCollapsed && (
              <>
                {groups.length === 0 && (
                  <p className="sidebar-section__empty">
                    暂无分组，点击 + 新建
                  </p>
                )}
                {visibleGroups.map((group) => {
                  const items = groupBuckets[group.id] ?? [];
                  const collapsed = !!groupCollapsed[group.id];
                  return (
                    <div key={group.id} className="sidebar-group">
                      <div className="sidebar-group__head">
                        <button
                          className="sidebar-group__toggle"
                          onClick={() => toggleGroupCollapsed(group.id)}
                          aria-expanded={!collapsed}
                        >
                          <Folder size={15} strokeWidth={1.6} />
                          <span className="sidebar-group__name">
                            {group.name}
                          </span>
                        </button>

                        {/* 行尾操作：置顶书签固定贴右边缘（与表头 + 对齐），
                            ⋯ / ⊕ 仅 hover 显形并排在书签左侧 */}
                        <div className="sidebar-group__actions">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="sidebar-group__icon-btn"
                                aria-label={`分组「${group.name}」更多操作`}
                                title="更多操作"
                              >
                                <Ellipsis size={14} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              sideOffset={4}
                              className="sidebar-menu"
                            >
                              <DropdownMenuItem
                                onSelect={() =>
                                  setGroupDialog({ mode: 'rename', group })
                                }
                              >
                                <Pencil />
                                重命名
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  togglePin(group.id);
                                  toast.success(
                                    group.pinned
                                      ? `已取消置顶「${group.name}」`
                                      : `已置顶「${group.name}」`,
                                  );
                                }}
                              >
                                <Pin />
                                {group.pinned ? '取消置顶' : '置顶'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  removeGroup(group.id);
                                  toast.success(`已删除分组「${group.name}」`);
                                }}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 />
                                删除分组
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>

                          <button
                            className="sidebar-group__icon-btn"
                            onClick={() => void handleNewInGroup(group)}
                            aria-label={`在「${group.name}」中新建会话`}
                            title="在此分组中新建会话"
                          >
                            <CirclePlus size={14} />
                          </button>

                          {/* 置顶书签常驻，位置固定在最右侧 */}
                          {group.pinned && (
                            <span
                              className="sidebar-group__pin"
                              aria-label="已置顶"
                              title="已置顶"
                            >
                              <Bookmark size={13} />
                            </span>
                          )}
                        </div>
                      </div>
                      {!collapsed && items.map(renderConversation)}
                    </div>
                  );
                })}

                {/* 分组过多时收起，点击展开全部 */}
                {hasMoreGroups && (
                  <button
                    className="sidebar-group__more"
                    onClick={() => setShowAllGroups(true)}
                  >
                    <Ellipsis size={14} />
                    更多分组
                  </button>
                )}
              </>
            )}
          </section>

          {/* ===== 最近区 ===== */}
          <section className="sidebar-section">
            <div className="sidebar-section__head">
              <button
                className="sidebar-section__toggle"
                onClick={() => setRecentCollapsed(!recentCollapsed)}
                aria-expanded={!recentCollapsed}
              >
                <span>最近</span>
                <ChevronRight
                  size={12}
                  className={`sidebar-section__chevron${
                    recentCollapsed ? '' : ' is-open'
                  }`}
                />
              </button>
            </div>

            {!recentCollapsed && (
              <>
                {recentConversations.length === 0 &&
                  !loading &&
                  conversations.length === 0 && (
                    <div className="sidebar-list-status sidebar-list-empty">
                      <EmptyStateGlyph variant="chat" size={28} />
                      <p className="sidebar-status-text">暂无会话</p>
                    </div>
                  )}
                {recentConversations.map(renderConversation)}
                {/* 无限滚动哨兵 */}
                <div ref={loadMoreRef} className="sidebar-load-more">
                  {loading && (
                    <span className="sidebar-load-more-text">加载中...</span>
                  )}
                </div>
              </>
            )}
          </section>
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

      {/* 分组新建 / 重命名对话框 */}
      <GroupNameDialog
        open={groupDialog !== null}
        onOpenChange={(open) => {
          if (!open) setGroupDialog(null);
        }}
        title={groupDialog?.mode === 'rename' ? '重命名分组' : '新建分组'}
        description={
          groupDialog?.mode === 'rename'
            ? '给分组换一个名字。'
            : '给分组起个名字，之后可把会话移动到分组中。'
        }
        submitText={groupDialog?.mode === 'rename' ? '保存' : '创建'}
        initialValue={
          groupDialog?.mode === 'rename' ? groupDialog.group.name : ''
        }
        onSubmit={handleGroupSubmit}
      />
    </TooltipProvider>
  );
}
