/**
 * 认证状态管理（Zustand）
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setToken, clearToken, getToken } from '../api/client';
import type { AuthStatus, UserProfile } from '../types/auth';

interface AuthStore {
  status: AuthStatus;
  user: UserProfile | null;
  error: string | null;

  /** 认证成功 — 保存用户与 Token
   * @param rememberMe true 存 localStorage（跨会话保留），false 存 sessionStorage（关闭浏览器清除）
   */
  authenticate: (user: UserProfile, token: string, refreshToken?: string, rememberMe?: boolean) => void;
  /** 登出 — 清除状态 */
  logout: () => void;
  /** 更新状态 */
  setStatus: (status: AuthStatus) => void;
  /** 设置错误信息 */
  setError: (error: string | null) => void;
  /** 初始化 — 根据 token 恢复认证状态 */
  init: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      status: 'idle',
      user: null,
      error: null,

      authenticate: (user, token, refreshToken, rememberMe = true) => {
        setToken(token, refreshToken, rememberMe);
        set({ status: 'authenticated', user, error: null });
      },

      logout: () => {
        clearToken();
        set({ status: 'idle', user: null, error: null });
      },

      setStatus: (status) => set({ status }),
      setError: (error) => set({ error }),

      /** 应用启动时调用：如果有 token 但 status 为 idle，恢复为 authenticated */
      init: () => {
        const token = getToken();
        if (token) {
          set({ status: 'authenticated' });
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
