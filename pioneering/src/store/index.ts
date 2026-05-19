import Taro from '@tarojs/taro';
import { create } from 'zustand';
import { STORAGE_KEYS } from '../constants';

export interface SystemInfo {
  statusBarHeight: number;
  navBarHeight: number;
  windowHeight: number;
  windowWidth: number;
  platform: string;
}

export interface UserInfo {
  id?: string;
  name?: string;
  email?: string;
  avatar?: string;
  company?: string;
  position?: string;
}

export interface AppSettings {
  darkMode: boolean;
  fontSize: 'small' | 'normal' | 'large';
  soundEnabled: boolean;
}

interface AppState {
  apiBaseUrl: string;

  isLoggedIn: boolean;
  userInfo: UserInfo | null;
  systemInfo: SystemInfo;
  settings: AppSettings;

  setLoggedIn: (loggedIn: boolean) => void;
  setUserInfo: (info: UserInfo | null) => void;
  setSystemInfo: (info: SystemInfo) => void;
  setSettings: (settings: Partial<AppSettings>) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  apiBaseUrl: 'https://your-api-domain.com',

  isLoggedIn: false,
  userInfo: null,
  systemInfo: {
    statusBarHeight: 0,
    navBarHeight: 0,
    windowHeight: 0,
    windowWidth: 0,
    platform: '',
  },
  settings: {
    darkMode: false,
    fontSize: 'normal',
    soundEnabled: true,
  },

  setLoggedIn: (loggedIn) => set({ isLoggedIn: loggedIn }),

  setUserInfo: (info) => set({ userInfo: info }),

  setSystemInfo: (info) => set({ systemInfo: info }),

  setSettings: (partial) =>
    set((state) => ({ settings: { ...state.settings, ...partial } })),

  logout: () => {
    set({ isLoggedIn: false, userInfo: null });
    try {
      Taro.removeStorageSync(STORAGE_KEYS.TOKEN);
      Taro.removeStorageSync(STORAGE_KEYS.USER_INFO);
    } catch {
      // ignore
    }
  },
}));
