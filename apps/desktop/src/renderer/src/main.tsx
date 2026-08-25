import React from 'react'
import ReactDOM from 'react-dom/client'

// 浏览器模式下模拟 Electron preload API（window.api / window.electron）
// Electron 环境下 window.api 已存在，mock 自动跳过，无副作用。
import './mocks/electron-mock'

import App from './App'
import './index.css'

// 云边双模阶段 1：控制台切换 Agent 传输通道（dev 冒烟用）
//   window.__setAgentTransportMode('ipc') / window.__setAgentTransportMode('http')
import { setAgentTransportMode } from './services/transport'
declare global {
  interface Window {
    __setAgentTransportMode?: (mode: 'http' | 'ipc') => void
  }
}
window.__setAgentTransportMode = (mode) => setAgentTransportMode(mode)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
