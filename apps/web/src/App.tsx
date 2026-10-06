import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './layout/Sidebar/Sidebar';
import { TopNav } from './layout/TopNav/TopNav';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useSourcesPanelStore } from './store/sourcesPanelStore';
import { SourcesPanel } from './modes/chat/components/SourcesPanel/SourcesPanel';
import { SourcesResizer } from './modes/chat/components/SourcesPanel/SourcesResizer';
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
  // 仅 /task 路由使用 shadcn/ui 实现的 TaskTopBar；
  // /pro 路由不使用全局 TopNav——其顶部栏由中间栏自身头部承载，与右侧面板同级
  const isTaskRoute = location.pathname.startsWith('/task');
  const isProRoute = location.pathname.startsWith('/pro');
  // 参考来源右侧栏仅在 /chat 下作为应用级第三列出现（结构对齐任务模式：
  // 与主列等高，标题栏置顶，TopNav 只横跨中间对话列，不压在面板上方）
  const isChatRoute = location.pathname.startsWith('/chat');
  const sourcesPanelOpen = useSourcesPanelStore((s) => s.open);
  const resetSourcesPanel = useSourcesPanelStore((s) => s.reset);

  // 离开 /chat 时关闭来源面板，避免返回后意外恢复
  useEffect(() => {
    if (!isChatRoute) resetSourcesPanel();
  }, [isChatRoute, resetSourcesPanel]);

  return (
    <ProtectedRoute>
      <ErrorBoundary>
        <div className="app-shell">
          <Sidebar />
          <div className="main-area">
            <div className="main-col">
              {!isTaskRoute && !isProRoute && <TopNav />}
              <div className="main-content">
                <Suspense fallback={<ModeFallback />}>
                  <Outlet />
                </Suspense>
              </div>
            </div>
            {isChatRoute && sourcesPanelOpen && (
              <>
                <SourcesResizer />
                <SourcesPanel />
              </>
            )}
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