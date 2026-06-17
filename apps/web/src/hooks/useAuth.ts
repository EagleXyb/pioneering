/**
 * 认证逻辑钩子
 * 消费 auth store + auth-api，对齐后端实际接口
 */
import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAuthStore } from '../stores/auth';
import { loginApi } from '../api/auth-api';
import type { LoginRequest } from '../types/auth';

export function useAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, status, error, authenticate, logout: storeLogout, setStatus, setError } = useAuthStore();

  /** 登录 — 后端 POST /auth/login，字段为 username + password */
  const login = useCallback(async (data: LoginRequest) => {
    setStatus('loading');
    setError(null);
    try {
      const res = await loginApi(data);
      authenticate(res.user, res.token, res.refreshToken);
      // 跳回原始目标路径，或默认 /chat
      const from = (location.state as any)?.from || '/chat';
      navigate(from, { replace: true });
    } catch (e: any) {
      const msg = e?.message || '登录失败，请检查用户名和密码';
      setError(msg);
      setStatus('error');
      throw e;
    }
  }, [navigate, location, authenticate, setStatus, setError]);

  /** 登出 — 清除本地状态并跳转登录页 */
  const logout = useCallback(async () => {
    storeLogout();
    navigate('/auth/login', { replace: true });
  }, [navigate, storeLogout]);

  const clearError = useCallback(() => setError(null), [setError]);

  return {
    user,
    status,
    error,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading',
    login,
    logout,
    clearError,
  };
}