/**
 * 数据管理分区 —— 已归档会话列表（原侧边栏「归档会话」入口的承载页）
 *
 * 对齐参考图样式：白色圆角卡片内逐行展示 标题 + 更新时间（YYYY/MM/DD HH:mm），
 * 行右侧两个图标按钮：删除（物理删除，二次确认）/ 取消归档（恢复为活跃会话）。
 *
 * 数据直接走 sessionApi（archived=true 游标分页），不读写 conversationStore 的
 * 列表状态（那是侧边栏活跃视图的数据源）；变更后调 fetchSessions() 让侧边栏同步。
 */
import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, Inbox, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  deleteSession,
  getSessions,
  updateSession,
} from '@/api/session';
import type { Session } from '@/api/types';
import { useConversationStore } from '../store/conversationStore';
import { ConfirmDialog } from '../layout/Sidebar/ConfirmDialog';

/**
 * YYYY/MM/DD HH:mm（参考图日期格式，本地时区）。
 * 归档会话展示的「时间」即为实际归档时间：归档动作（updateSession{isArchived:true}）
 * 会刷新会话的 updatedAt 为归档那一刻，且归档会话在 UI 内不会被继续发消息，
 * 故此处复用 updatedAt 即等于实际归档时间（见设置数据管理需求，零后端改动方案）。
 */
function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** 从未知异常中提取 message */
function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return fallback;
}

export function ArchivedSessionsSection() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  /** 恢复中的会话 id（行内按钮 loading） */
  const [restoringId, setRestoringId] = useState<string | null>(null);
  /** 待删除确认的会话 */
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getSessions(undefined, 50, true);
      setSessions(resp.sessions);
      setNextCursor(resp.nextCursor);
      setHasMore(resp.hasMore);
    } catch (e) {
      setError(errorMessage(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const resp = await getSessions(nextCursor, 50, true);
      setSessions((prev) => {
        const existing = new Set(prev.map((s) => s.id));
        return [...prev, ...resp.sessions.filter((s) => !existing.has(s.id))];
      });
      setNextCursor(resp.nextCursor);
      setHasMore(resp.hasMore);
    } catch (e) {
      toast.error(`加载更多失败：${errorMessage(e, '请稍后重试')}`);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  /** 变更后同步侧边栏（活跃列表可能新增/减少会话） */
  const syncSidebar = useCallback(() => {
    void useConversationStore.getState().fetchSessions();
  }, []);

  /** 取消归档：isArchived=false，从列表移除 */
  const handleRestore = useCallback(
    async (s: Session) => {
      setRestoringId(s.id);
      try {
        await updateSession(s.id, { isArchived: false });
        setSessions((prev) => prev.filter((x) => x.id !== s.id));
        toast.success('已恢复为活跃会话');
        syncSidebar();
      } catch (e) {
        toast.error(`恢复失败：${errorMessage(e, '请稍后重试')}`);
      } finally {
        setRestoringId(null);
      }
    },
    [syncSidebar],
  );

  /** 确认删除：物理删除（archive=false），从列表移除 */
  const confirmDelete = useCallback(async () => {
    const s = deleteTarget;
    if (!s) return;
    setDeleting(true);
    try {
      await deleteSession(s.id, false);
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      toast.success('已删除');
      setDeleteTarget(null);
      syncSidebar();
    } catch (e) {
      toast.error(`删除失败：${errorMessage(e, '请稍后重试')}`);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, syncSidebar]);

  return (
    <section className="settings-group">
      <h3 className="settings-group-title">已归档的会话</h3>
      <div className="settings-group-card">
        {loading && <div className="archived-status">加载中…</div>}

        {!loading && error && (
          <div className="archived-status">
            {error}
            <button type="button" className="settings-inline-action" onClick={load}>
              重试
            </button>
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="archived-empty">
            <Inbox size={28} strokeWidth={1.5} />
            <span>暂无归档的会话</span>
          </div>
        )}

        {sessions.map((s) => (
          <div key={s.id} className="archived-row">
            <div className="archived-row-main">
              <span className="archived-row-title" title={s.title}>
                {s.title || '未命名会话'}
              </span>
              {/* updatedAt 在此即等于实际归档时间（归档动作刷新的时刻） */}
              <span className="archived-row-date">{formatDateTime(s.updatedAt)}</span>
            </div>
            <div className="archived-row-actions">
              <button
                type="button"
                className="archived-row-btn archived-row-btn--danger"
                onClick={() => setDeleteTarget(s)}
                title="删除"
                aria-label={`删除会话 ${s.title || ''}`}
              >
                <Trash2 />
              </button>
              <button
                type="button"
                className="archived-row-btn"
                onClick={() => void handleRestore(s)}
                disabled={restoringId === s.id}
                title="取消归档"
                aria-label={`取消归档 ${s.title || ''}`}
              >
                <ArchiveRestore />
              </button>
            </div>
          </div>
        ))}

        {!loading && hasMore && (
          <div className="archived-load-more">
            <button
              type="button"
              className="archived-load-more-btn"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          </div>
        )}
      </div>

      {/* 删除二次确认（与侧边栏删除会话同一组件） */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        title="确认删除"
        description={`确定要删除会话「${deleteTarget?.title || '未命名会话'}」吗？删除后数据不可恢复。`}
        confirmText="确认删除"
        danger
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
