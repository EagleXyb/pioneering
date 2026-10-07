import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './store/themeContext';
import { Toaster } from './components/ui/sonner';
// HITL 宿主接线（副作用：bindHitlHost）
import './lib/agent-host';

// 全局设计 Token
import './styles/tokens.css';

// 全局 Reset
import './index.css';

// Tailwind 4 + shadcn/desktop 对齐令牌（全站生效）
import './styles/tailwind.css';

// 三模式共享的对话消息与输入区样式
import './styles/conversation.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
      {/* 全局 sonner toast */}
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  </React.StrictMode>,
);