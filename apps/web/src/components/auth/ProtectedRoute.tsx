/**
 * 路由守卫 — 未登录跳转登录页，已登录放行
 */
import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuthStore } from '../../stores/auth';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { status, init } = useAuthStore();
  const location = useLocation();

  // 首次加载时根据 token 恢复认证状态
  useEffect(() => {
    init();
  }, [init]);

  const isAuthenticated = status === 'authenticated';

  if (!isAuthenticated) {
    // 保存原始目标路径，登录后跳回
    return <Navigate to="/auth/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}