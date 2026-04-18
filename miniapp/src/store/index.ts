import { create } from 'zustand';

interface UserInfo {
  name?: string;
  email?: string;
  avatar?: string;
  company?: string;
  position?: string;
  location?: string;
}

interface AppState {
  apiBaseUrl: string;
  userInfo: UserInfo | null;
  isLoggedIn: boolean;
  setLoggedIn: (loggedIn: boolean) => void;
  setUserInfo: (info: UserInfo | null) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  apiBaseUrl: 'https://your-api-domain.com',
  userInfo: null,
  isLoggedIn: false,
  setLoggedIn: (loggedIn) => set({ isLoggedIn: loggedIn }),
  setUserInfo: (info) => set({ userInfo: info }),
  logout: () => {
    set({ isLoggedIn: false, userInfo: null });
  },
}));
