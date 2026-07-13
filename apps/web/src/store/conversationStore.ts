import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as sessionApi from '../api/session';
import type { Session } from '../api/types';
import type { AppMode } from '../types';
import { getDefaultModel } from '../config/models';

export interface Conversation {
  id: string;
  title: string;
  mode: AppMode;
  preview: string;
  createdAt: string;
  updatedAt: string;
  group: '今天' | '昨天' | '更早';
  isArchived: boolean;
}

interface ConversationStore {
  conversations: Conversation[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  total: number;
  /** 游标分页：下一页游标，null 表示无更多数据 */
  nextCursor: string | null;
  /** 后端是否还有更多数据 */
  hasMore: boolean;
  /** 是否正在查看归档视图（控制拉取 archived 会话） */
  archivedView: boolean;
  /** 会话 mode 映射 (sessionId -> mode)，本地持久化，弥补后端无 mode 字段 */
  sessionModes: Record<string, AppMode>;
  /** 是否正在创建会话（乐观更新期间为 true） */
  creating: boolean;
  /** 当前正在进行的创建会话 Promise（用于并发去重与等待） */
  createPromise: Promise<string> | null;
  /** 正在拉取的游标，防止重复请求同一页 */
  fetchingCursor: string | null;

  /** 从后端加载会话列表（首页）
   * @param archived 是否拉取已归档会话；省略时读取当前 archivedView 状态
   */
  fetchSessions: (archived?: boolean) => Promise<void>;
  /** 加载下一页会话（游标分页 + 按 id 去重） */
  fetchMoreSessions: () => Promise<void>;
  /** 切换归档视图（自动重新拉取对应归档状态的会话） */
  setArchivedView: (archived: boolean) => Promise<void>;
  /** 创建新会话（乐观更新 + 调用后端 API，幂等替换 tempId） */
  create: (mode: AppMode) => Promise<string>;
  /** 激活会话 */
  activate: (id: string) => void;
  /** 删除/归档会话（调用后端 API），archive=true 归档，false 物理删除 */
  remove: (id: string, archive?: boolean) => Promise<void>;
  /** 更新预览（本地操作，不调 API） */
  updatePreview: (id: string, preview: string) => void;
  /** 更新标题（调用后端 API） */
  updateTitle: (id: string, title: string) => Promise<void>;
  /** 恢复归档会话为活跃（调用后端 API 更新 isArchived=false） */
  restoreFromArchive: (id: string) => Promise<void>;
}

function getGroup(dateStr: string): '今天' | '昨天' | '更早' {
  const now = new Date();
  const date = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  if (date >= today) return '今天';
  if (date >= yesterday) return '昨天';
  return '更早';
}

/** 将后端 Session 转换为本地 Conversation，mode 从 sessionModes 映射中获取 */
function sessionToConversation(s: Session, sessionModes: Record<string, AppMode>): Conversation {
  return {
    id: s.id,
    title: s.title,
    mode: sessionModes[s.id] || 'chat',
    preview: s.lastMessage?.content || '',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    group: getGroup(s.updatedAt),
    isArchived: s.isArchived ?? false,
  };
}

/** 按 id 去重，保留首次出现的项 */
function dedupeById<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of list) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

export const useConversationStore = create<ConversationStore>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      loading: false,
      error: null,
      total: 0,
      nextCursor: null,
      hasMore: false,
      archivedView: false,
      sessionModes: {},
      creating: false,
      createPromise: null,
      fetchingCursor: null,

      fetchSessions: async (archived?: boolean) => {
        const wantArchived = archived ?? get().archivedView;
        set({ loading: true, error: null, archivedView: wantArchived });
        try {
          const resp = await sessionApi.getSessions(undefined, 50, wantArchived);
          const { sessionModes } = get();
          const conversations = resp.sessions.map((s) => sessionToConversation(s, sessionModes));
          set({
            conversations,
            loading: false,
            total: resp.total,
            nextCursor: resp.nextCursor,
            hasMore: resp.hasMore,
          });
        } catch (e: any) {
          set({ loading: false, error: e?.message || '加载会话列表失败' });
        }
      },

      fetchMoreSessions: async () => {
        const { hasMore, loading, nextCursor, fetchingCursor, total, sessionModes, archivedView } = get();
        // 终止条件：无更多数据 / 正在加载 / 无游标 / 正在拉取同一游标
        if (loading || !hasMore || !nextCursor || fetchingCursor === nextCursor) return;
        // 防止重复项撑大 length 造成误判（基于去重后的长度）
        const dedupedLen = dedupeById(get().conversations).length;
        if (dedupedLen >= total) return;

        set({ loading: true, error: null, fetchingCursor: nextCursor });
        try {
          const resp = await sessionApi.getSessions(nextCursor, 50, archivedView);
          const newConversations = resp.sessions.map((s) => sessionToConversation(s, sessionModes));
          // 函数式更新：用最新 state 拼接，避免闭包捕获陈旧 conversations
          // 按 id 去重：即使后端因游标漂移返回了已存在的会话，也不会重复插入
          set((s) => {
            const existingIds = new Set(s.conversations.map((c) => c.id));
            const filtered = newConversations.filter((c) => !existingIds.has(c.id));
            return {
              conversations: [...s.conversations, ...filtered],
              loading: false,
              fetchingCursor: null,
              nextCursor: resp.nextCursor,
              hasMore: resp.hasMore,
              // total 以后端最新返回为准，防止旧值偏小导致提前终止
              total: resp.total,
            };
          });
        } catch (e: any) {
          set({ loading: false, error: e?.message || '加载更多失败', fetchingCursor: null });
        }
      },

      setArchivedView: async (archived) => {
        const current = get().archivedView;
        if (current === archived) return;
        // 切换视图时清空当前列表，避免不同归档状态的会话混在一起
        set({ archivedView: archived, conversations: [], nextCursor: null, hasMore: false, activeId: null });
        await get().fetchSessions(archived);
      },

      create: async (mode) => {
        // 并发去重：若已有正在进行的创建请求，复用同一个 Promise
        const existing = get().createPromise;
        if (existing) return existing;

        // 乐观更新：立即生成本地临时会话并插入列表顶部、激活
        const tempId = `temp_${Date.now()}`;
        const now = new Date().toISOString();
        const tempConversation: Conversation = {
          id: tempId,
          title: '新会话',
          mode,
          preview: '',
          createdAt: now,
          updatedAt: now,
          group: '今天',
          isArchived: false,
        };
        const prevActiveId = get().activeId;
        set({
          conversations: [tempConversation, ...get().conversations],
          activeId: tempId,
          sessionModes: { ...get().sessionModes, [tempId]: mode },
          total: get().total + 1,
          creating: true,
          error: null,
        });

        // 后台异步调用后端 API
        const promise = (async () => {
          try {
            const session = await sessionApi.createSession({
              title: '新会话',
              model: getDefaultModel(mode),
            });
            const conversation = sessionToConversation(session, { [session.id]: mode });

            set((s) => {
              // 幂等替换：先移除临时会话（若仍存在）
              const withoutTemp = s.conversations.filter((c) => c.id !== tempId);
              // 若真实会话已被并发 fetchSessions 拉回，更新而非重复插入
              const existsIdx = withoutTemp.findIndex((c) => c.id === session.id);
              const newConversations = existsIdx >= 0
                ? withoutTemp.map((c) => (c.id === session.id ? conversation : c))
                : [conversation, ...withoutTemp];
              const newSessionModes = Object.fromEntries(
                Object.entries(s.sessionModes).filter(([k]) => k !== tempId),
              );
              newSessionModes[session.id] = mode;
              return {
                conversations: newConversations,
                activeId: s.activeId === tempId ? session.id : s.activeId,
                sessionModes: newSessionModes,
              };
            });

            return session.id;
          } catch (e: any) {
            // 创建失败：回滚，移除临时会话
            set((s) => {
              const filtered = s.conversations.filter((c) => c.id !== tempId);
              const newSessionModes = Object.fromEntries(
                Object.entries(s.sessionModes).filter(([k]) => k !== tempId),
              );
              return {
                conversations: filtered,
                activeId: s.activeId === tempId ? prevActiveId : s.activeId,
                sessionModes: newSessionModes,
                total: Math.max(0, s.total - 1),
                error: e?.message || '创建会话失败',
              };
            });
            throw e;
          } finally {
            set({ creating: false, createPromise: null });
          }
        })();

        set({ createPromise: promise });
        return promise;
      },

      activate: (id) => set({ activeId: id }),

      remove: async (id, archive = true) => {
        await sessionApi.deleteSession(id, archive);
        set((s) => {
          const filtered = s.conversations.filter((c) => c.id !== id);
          const { [id]: _, ...restModes } = s.sessionModes;
          return {
            conversations: filtered,
            activeId: s.activeId === id ? null : s.activeId,
            sessionModes: restModes,
            total: Math.max(0, s.total - 1),
          };
        });
      },

      updatePreview: (id, preview) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, preview, updatedAt: new Date().toISOString() } : c
          ),
        })),

      updateTitle: async (id, title) => {
        await sessionApi.updateSession(id, { title });
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title } : c
          ),
        }));
      },

      restoreFromArchive: async (id) => {
        await sessionApi.updateSession(id, { isArchived: false });
        // 归档视图中移除该会话（它已恢复到活跃列表）
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== id),
          total: Math.max(0, s.total - 1),
        }));
      },
    }),
    {
      name: 'conversation-store',
      partialize: (state) => ({ sessionModes: state.sessionModes }),
    },
  ),
);
