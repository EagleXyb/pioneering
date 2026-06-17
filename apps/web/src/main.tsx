import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './store/themeContext';
import { ToastProvider } from './store/toastContext';

// TDesign 样式
import 'tdesign-react/es/style/index.css';

// TDesign Chat 样式
import '@tdesign-react/chat/es/style/index.js';

// 全局设计 Token
import './styles/tokens.css';

// 全局 Reset
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);