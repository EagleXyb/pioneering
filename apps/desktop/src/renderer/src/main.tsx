import React from 'react'
import ReactDOM from 'react-dom/client'

// 浏览器模式下模拟 Electron preload API（window.api / window.electron）
// Electron 环境下 window.api 已存在，mock 自动跳过，无副作用。
import './mocks/electron-mock'

import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
