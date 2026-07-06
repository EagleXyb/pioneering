import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { RootLayout } from './layouts/RootLayout'
import { HomePage } from './pages/HomePage'
import { ChatPage } from './pages/ChatPage'
import { AgentPage } from './pages/AgentPage'
import { WorkspacePage } from './pages/WorkspacePage'
import { useAppStore } from './stores/useAppStore'
import { useSetAtom } from 'jotai'
import { platformAtom, type Platform } from './stores/atoms'
import { appApi } from './services/ipc'

// 主进程 process.platform → 渲染端归一化平台标识
function normalizePlatform(p: string): Platform {
  if (p === 'darwin') return 'mac'
  if (p === 'win32') return 'windows'
  if (p === 'linux') return 'linux'
  return 'unknown'
}

function App() {
  const initTheme = useAppStore((s) => s.initTheme)
  const setPlatform = useSetAtom(platformAtom)

  useEffect(() => {
    initTheme()
  }, [initTheme])

  // 经 IPC 获取真实平台，写入 platformAtom 并同步到 <html data-platform>
  useEffect(() => {
    appApi
      .getPlatform()
      .then((p) => {
        const platform = normalizePlatform(p)
        setPlatform(platform)
        if (platform !== 'unknown') {
          document.documentElement.dataset.platform = platform
        }
      })
      .catch(() => {})
  }, [setPlatform])

  return (
      <HashRouter>
        <Routes>
          <Route element={<RootLayout />}>
            <Route index element={<ChatPage />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/workspace" element={<WorkspacePage />} />
          </Route>
        </Routes>
      </HashRouter>
  )
}

export default App
