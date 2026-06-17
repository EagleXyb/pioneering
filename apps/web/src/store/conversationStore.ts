import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as sessionApi from '../api/session';
import type { Session } from '../api/types';
import type { AppMode } from '../types';

export interface Conversation {
  id: string;
  title: string;
  mode: AppMode;
  preview: string;
  createdAt: string;
  updatedAt: string;
  group: '今天' | '昨天' | '更早';
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

  /** 从后端加载会话列表（首页） */
  fetchSessions: () => Promise<void>;
  /** 加载下一页会话 */
  fetchMoreSessions: () => Promise<void>;
  /** 创建新会话（调用后端 API） */
  create: (mode: AppMode) => Promise<string>;
  /** 激活会话 */
  activate: (id: string) => void;
  /** 删除/归档会话（调用后端 API） */
  remove: (id: string) => Promise<void>;
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
        const session = await sessionApi.createSession({
          title: '新会话',
          model: 'deepseek-v4-flash',
        });
        const conversation = sessionToConversation(session, { [session.id]: mode });
        set({
          conversations: [conversation, ...get().conversations],
          activeId: session.id,
          sessionModes: { ...get().sessionModes, [session.id]: mode },
          total: get().total + 1,
        });
        return session.id;
      },

      activate: (id) => set({ activeId: id }),

      remove: async (id) => {
        await sessionApi.deleteSession(id, true);
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
