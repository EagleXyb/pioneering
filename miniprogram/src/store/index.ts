import { create } from 'zustand';
import type { ChatMessage, ChatPhase, SessionItem } from '@/types/chat';

// ====== Store 接口 ======
export interface AppStore {
  // 会话
  currentSessionId: string;
  sessions: SessionItem[];

  // 消息（按会话 ID 索引）
  messagesMap: Record<string, ChatMessage[]>;

  // 对话阶段
  chatPhase: ChatPhase;

  // SSE 中断控制
  abortController: AbortController | null;

  // 会话操作
  setCurrentSessionId: (id: string) => void;
  addSession: (session: SessionItem) => void;
  removeSession: (id: string) => void;
  updateSession: (id: string, partial: Partial<SessionItem>) => void;

  // 消息操作
  addMessage: (sessionId: string, msg: ChatMessage) => void;
  updateMessage: (sessionId: string, msgId: string, partial: Partial<ChatMessage>) => void;
  clearMessages: (sessionId: string) => void;

  // 上下文窗口（自动截断最近 N 轮）
  getContextWindow: (sessionId: string, maxRounds?: number) => ChatMessage[];

  // 阶段控制
  setChatPhase: (phase: ChatPhase) => void;

  // 中断控制
  setAbortController: (ctrl: AbortController) => void;
  clearAbortController: () => void;
}

export const useAppStore = create<AppStore>()((set, get) => ({
  currentSessionId: '',
  sessions: [],
  messagesMap: {},
  chatPhase: 'idle',
  abortController: null,

  // ---- 会话操作 ----
  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  addSession: (session) =>
    set((state) => ({ sessions: [session, ...state.sessions] })),
  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),
  updateSession: (id, partial) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...partial } : s,
      ),
    })),

  // ---- 消息操作 ----
  addMessage: (sessionId, msg) =>
    set((state) => ({
      messagesMap: {
        ...state.messagesMap,
        [sessionId]: [...(state.messagesMap[sessionId] || []), msg],
      },
    })),

  updateMessage: (sessionId, msgId, partial) =>
    set((state) => {
      const msgs = state.messagesMap[sessionId];
      if (!msgs) return state;
      return {
        messagesMap: {
          ...state.messagesMap,
          [sessionId]: msgs.map((m) =>
            m.id === msgId ? { ...m, ...partial } : m,
          ),
        },
      };
    }),

  clearMessages: (sessionId) =>
    set((state) => {
      const next = { ...state.messagesMap };
      delete next[sessionId];
      return { messagesMap: next };
    }),

  // ---- 上下文窗口 ----
  getContextWindow: (sessionId, maxRounds = 10) => {
    const msgs = get().messagesMap[sessionId] || [];
    const recent = msgs.slice(-maxRounds * 2); // 每轮 = 用户 + AI 共 2 条
    return recent;
  },

  // ---- 阶段控制 ----
  setChatPhase: (phase) => set({ chatPhase: phase }),

  // ---- 中断控制 ----
  setAbortController: (ctrl) => set({ abortController: ctrl }),
  clearAbortController: () => set({ abortController: null }),
}));

// 类型重导出
export type { SessionItem };