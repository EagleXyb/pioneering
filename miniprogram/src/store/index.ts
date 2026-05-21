import { create } from 'zustand';

// ====== 会话列表项 ======
export interface SessionItem {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
}

// ====== 最小闭环 Store：仅管理 currentSessionId + sessions ======
export interface AppStore {
  currentSessionId: string;
  sessions: SessionItem[];

  setCurrentSessionId: (id: string) => void;
  addSession: (session: SessionItem) => void;
  removeSession: (id: string) => void;
  updateSession: (id: string, partial: Partial<SessionItem>) => void;
}

export const useAppStore = create<AppStore>()((set) => ({
  currentSessionId: '',
  sessions: [],

  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  addSession: (session) =>
    set((state) => ({ sessions: [session, ...state.sessions] })),
  removeSession: (id) =>
    set((state) => ({ sessions: state.sessions.filter((s) => s.id !== id) })),
  updateSession: (id, partial) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...partial } : s
      ),
    })),
}));
