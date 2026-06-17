import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { Sidebar } from './layout/Sidebar/Sidebar';
import { TopNav } from './layout/TopNav/TopNav';
import './layout/AppShell.css';

const ChatMode = lazy(() => import('./modes/chat/ChatMode'));
const ProMode = lazy(() => import('./modes/pro/ProMode'));
const TaskMode = lazy(() => import('./modes/task/TaskMode'));

function ModeFallback() {
  return <div className="mode-loading">加载中...</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <Sidebar />
        <div className="main-area">
          <TopNav />
          <div className="main-content">
            <Suspense fallback={<ModeFallback />}>
              <Routes>
                <Route path="/chat" element={<ChatMode />} />
                <Route path="/pro" element={<ProMode />} />
                <Route path="/task" element={<TaskMode />} />
                <Route path="*" element={<Navigate to="/chat" replace />} />
              </Routes>
            </Suspense>
          </div>
        </div>
      </div>
    </BrowserRouter>
  );
}