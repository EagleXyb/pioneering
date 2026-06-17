import { create } from 'zustand';
import type { AppMode } from '../types';

interface AppStore {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  mode: 'chat',
  setMode: (mode) => set({ mode }),
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));