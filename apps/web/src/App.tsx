import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router';
import { Sidebar } from './layout/Sidebar/Sidebar';
import { TopNav } from './layout/TopNav/TopNav';
import { TaskTopBar } from './layout/TaskTopBar/TaskTopBar';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import './layout/AppShell.css';

const ChatMode = lazy(() => import('./modes/chat/ChatMode'));
const ProMode = lazy(() => import('./modes/pro/ProMode'));
const TaskMode = lazy(() => import('./modes/task/TaskMode'));
const LoginPage = lazy(() => import('./pages/auth/Login'));
const RegisterPage = lazy(() => import('./pages/auth/Register'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPassword'));
const HelpPage = lazy(() => import('./pages/Help/HelpPage'));
const NotFoundPage = lazy(() => import('./pages/NotFound'));

function ModeFallback() {
  return <div className="mode-loading">加载中...</div>;
}

/** 需要 Sidebar + TopNav 的主应用布局（受路由守卫保护） */
function AppLayout() {
  const location = useLocation();
  // 仅 /task 路由使用 shadcn/ui 实现的 TaskTopBar，其他路由保持 TDesign TopNav
  const isTaskRoute = location.pathname.startsWith('/task');

  return (
    <ProtectedRoute>
      <ErrorBoundary>
        <div className="app-shell">
          <Sidebar />
          <div className="main-area">
            {isTaskRoute ? <TaskTopBar /> : <TopNav />}
            <div className="main-content">
              <Suspense fallback={<ModeFallback />}>
                <Outlet />
              </Suspense>
            </div>
          </div>
        </div>
      </ErrorBoundary>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          {/* 认证页面 — 无 Sidebar/TopNav，无需守卫 */}
          <Route path="/auth/login" element={<Suspense fallback={<ModeFallback />}><LoginPage /></Suspense>} />
          <Route path="/auth/register" element={<Suspense fallback={<ModeFallback />}><RegisterPage /></Suspense>} />
          <Route path="/auth/forgot-password" element={<Suspense fallback={<ModeFallback />}><ForgotPasswordPage /></Suspense>} />

          {/* 帮助与反馈 — 独立全屏浮层，需要登录 */}
          <Route
            path="/help"
            element={
              <ProtectedRoute>
                <Suspense fallback={<ModeFallback />}>
                  <HelpPage />
                </Suspense>
              </ProtectedRoute>
            }
          />

          {/* 主应用 — 受路由守卫保护，未登录跳转登录页 */}
          <Route element={<AppLayout />}>
            <Route path="/chat" element={<ChatMode />} />
            <Route path="/pro" element={<ProMode />} />
            <Route path="/task" element={<TaskMode />} />
          </Route>

          {/* 404 — 未匹配路径展示 NotFound 页面 */}
          <Route path="*" element={<Suspense fallback={<ModeFallback />}><NotFoundPage /></Suspense>} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}