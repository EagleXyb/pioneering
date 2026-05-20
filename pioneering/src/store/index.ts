import { create } from 'zustand';

export interface SystemInfo {
  statusBarHeight: number;
  navBarHeight: number;
  windowHeight: number;
  windowWidth: number;
  platform: string;
}

interface AppState {
  systemInfo: SystemInfo;
  setSystemInfo: (info: SystemInfo) => void;
}

export const useAppStore = create<AppState>((set) => ({
  systemInfo: {
    statusBarHeight: 0,
    navBarHeight: 0,
    windowHeight: 0,
    windowWidth: 0,
    platform: '',
  },

  setSystemInfo: (info) => set({ systemInfo: info }),
}));
