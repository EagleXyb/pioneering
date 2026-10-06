import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './store/themeContext';
import { Toaster } from './components/ui/sonner';

// 全局设计 Token
import './styles/tokens.css';

// 全局 Reset
import './index.css';

// Tailwind 4 + shadcn/desktop 对齐令牌（全站生效）
import './styles/tailwind.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
      {/* 全局 sonner toast（阶段 2 起替代 TDesign MessagePlugin） */}
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  </React.StrictMode>,
);