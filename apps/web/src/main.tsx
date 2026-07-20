import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './store/themeContext';

// TDesign 样式
import 'tdesign-react/es/style/index.css';

// TDesign Chat 样式
import '@tdesign-react/chat/es/style/index.js';

// 全局设计 Token
import './styles/tokens.css';

// 全局 Reset
import './index.css';

// Tailwind + shadcn token（作用域限定在 .tw-scope，不影响其他模式）
import './styles/tailwind.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);