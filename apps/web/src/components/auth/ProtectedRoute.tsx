/**
 * 路由守卫 — 未登录跳转登录页，已登录放行
 * 注意：status 在 persist hydration 时已根据 token 恢复（见 auth store onRehydrateStorage）
 * 这里仍保留 init() 调用作为兜底，处理 hydration 之后才写入 token 的边缘场景
 */
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuthStore } from '../../store/auth';
import { getToken } from '../../api/client';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);
  const location = useLocation();

  // 首次加载时同步检查 token：若 token 存在但 status 为 idle，立即恢复
  // 避免 useEffect 异步执行前已渲染 Navigate 导致闪到登录页
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!checked) {
      init();
      setChecked(true);
    }
  }, [init, checked]);

  // 同步兜底：render 阶段直接读 token，若 token 存在则视为已认证
  // 避免 hydration 与 useEffect 之间的间隙被 Navigate 捕获
  const isAuthenticated = status === 'authenticated' || (!!getToken() && !checked);

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}