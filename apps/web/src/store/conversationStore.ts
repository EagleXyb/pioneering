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
  currentPage: number;
  /** 会话 mode 映射 (sessionId -> mode)，本地持久化，弥补后端无 mode 字段 */
  sessionModes: Record<string, AppMode>;
  /** 是否正在创建会话（乐观更新期间为 true） */
  creating: boolean;
  /** 当前正在进行的创建会话 Promise（用于并发去重与等待） */
  createPromise: Promise<string> | null;

  /** 从后端加载会话列表（首页） */
  fetchSessions: () => Promise<void>;
  /** 加载下一页会话 */
  fetchMoreSessions: () => Promise<void>;
  /** 创建新会话（乐观更新 + 调用后端 API） */
  create: (mode: AppMode) => Promise<string>;
  /** 激活会话 */
  activate: (id: string) => void;
  /** 删除/归档会话（调用后端 API），archive=true 归档，false 物理删除 */
  remove: (id: string, archive?: boolean) => Promise<void>;
  /** 更新预览（本地操作，不调 API） */
  updatePreview: (id: string, preview: string) => void;
  /** 更新标题（调用后端 API） */
  updateTitle: (id: string, title: string) => Promise<void>;
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

export const useConversationStore = create<ConversationStore>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      loading: false,
      error: null,
      total: 0,
      currentPage: 0,
      sessionModes: {},
      creating: false,
      createPromise: null,

      fetchSessions: async () => {
        set({ loading: true, error: null });
        try {
          const resp = await sessionApi.getSessions(1, 50);
          const { sessionModes } = get();
          const conversations = resp.sessions.map((s) => sessionToConversation(s, sessionModes));
          set({ conversations, loading: false, total: resp.total, currentPage: 1 });
        } catch (e: any) {
          set({ loading: false, error: e?.message || '加载会话列表失败' });
        }
      },

      fetchMoreSessions: async () => {
        const { currentPage, total, conversations, loading, sessionModes } = get();
        if (loading || conversations.length >= total) return;
        const nextPage = currentPage + 1;
        set({ loading: true, error: null });
        try {
          const resp = await sessionApi.getSessions(nextPage, 50);
          const newConversations = resp.sessions.map((s) => sessionToConversation(s, sessionModes));
          set({
            conversations: [...conversations, ...newConversations],
            loading: false,
            currentPage: nextPage,
          });
        } catch (e: any) {
          set({ loading: false, error: e?.message || '加载更多失败' });
        }
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
              const newConversations = s.conversations.map((c) =>
                c.id === tempId ? conversation : c,
              );
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
    }),
    {
      name: 'conversation-store',
      partialize: (state) => ({ sessionModes: state.sessionModes }),
    },
  ),
);
