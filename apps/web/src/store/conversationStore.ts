import { create } from 'zustand';
import * as sessionApi from '../api/session';
import type { Session } from '../api/types';

export interface Conversation {
  id: string;
  title: string;
  mode: 'chat' | 'pro' | 'task';
  preview: string;
  createdAt: string;
  updatedAt: string;
  group: '今天' | '昨天' | '更早';
}

interface ConversationStore {
  conversations: Conversation[];
  activeId: string | null;
  loading: boolean;

  /** 从后端加载会话列表 */
  fetchSessions: () => Promise<void>;
  /** 创建新会话（调用后端 API） */
  create: (mode: 'chat' | 'pro' | 'task') => Promise<string>;
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

/** 将后端 Session 转换为本地 Conversation */
function sessionToConversation(s: Session, mode: 'chat' | 'pro' | 'task' = 'chat'): Conversation {
  return {
    id: s.id,
    title: s.title,
    mode,
    preview: s.lastMessage?.content || '',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    group: getGroup(s.updatedAt),
  };
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],
  activeId: null,
  loading: false,

  fetchSessions: async () => {
    set({ loading: true });
    try {
      const resp = await sessionApi.getSessions(1, 50);
      const conversations = resp.sessions.map((s) => sessionToConversation(s));
      set({ conversations, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  create: async (mode) => {
    const session = await sessionApi.createSession({
      title: '新会话',
      model: 'gpt-4o-mini',
    });
    const conversation = sessionToConversation(session, mode);
    set({
      conversations: [conversation, ...get().conversations],
      activeId: session.id,
    });
    return session.id;
  },

  activate: (id) => set({ activeId: id }),

  remove: async (id) => {
    await sessionApi.deleteSession(id, true);
    set((s) => {
      const filtered = s.conversations.filter((c) => c.id !== id);
      return {
        conversations: filtered,
        activeId: s.activeId === id ? null : s.activeId,
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
}));
