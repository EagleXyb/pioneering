import { create } from 'zustand';
import type { StateCreator } from 'zustand';

// ====== App Slice ======
export interface SystemInfo {
  statusBarHeight: number;
  navBarHeight: number;
  windowHeight: number;
  windowWidth: number;
  platform: string;
}

export interface AppSlice {
  systemInfo: SystemInfo;
  setSystemInfo: (info: SystemInfo) => void;
}

const createAppSlice: StateCreator<AppSlice> = (set) => ({
  systemInfo: {
    statusBarHeight: 0,
    navBarHeight: 0,
    windowHeight: 0,
    windowWidth: 0,
    platform: '',
  },
  setSystemInfo: (info) => set({ systemInfo: info }),
});

// ====== Auth Slice ======
export interface AuthSlice {
  token: string;
  openid: string;
  isLoggedIn: boolean;
  setAuth: (token: string, openid: string) => void;
  clearAuth: () => void;
}

const createAuthSlice: StateCreator<AuthSlice> = (set) => ({
  token: '',
  openid: '',
  isLoggedIn: false,
  setAuth: (token, openid) => set({ token, openid, isLoggedIn: true }),
  clearAuth: () => set({ token: '', openid: '', isLoggedIn: false }),
});

// ====== Chat Slice ======
export interface ChatSlice {
  currentSessionId: string;
  chatMode: 'script' | 'ai';
  setCurrentSessionId: (id: string) => void;
  setChatMode: (mode: 'script' | 'ai') => void;
  resetChatState: () => void;
}

const createChatSlice: StateCreator<ChatSlice> = (set) => ({
  currentSessionId: '',
  chatMode: 'script',
  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  setChatMode: (mode) => set({ chatMode: mode }),
  resetChatState: () => set({ currentSessionId: '' }),
});

// ====== 合并 Store ======
export type StoreState = AppSlice & AuthSlice & ChatSlice;

export const useAppStore = create<StoreState>()((...a) => ({
  ...createAppSlice(...a),
  ...createAuthSlice(...a),
  ...createChatSlice(...a),
}));
