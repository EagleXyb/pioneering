import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { RootLayout } from './layouts/RootLayout'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { ChatPage } from './pages/ChatPage'
import { AgentPage } from './pages/AgentPage'
import { WorkspacePage } from './pages/WorkspacePage'
import { useAppStore } from './stores/useAppStore'

function App() {
  const initTheme = useAppStore((s) => s.initTheme)

  useEffect(() => {
    initTheme()
  }, [initTheme])

  return (
      <HashRouter>
        <Routes>
          <Route element={<RootLayout />}>
            <Route index element={<ChatPage />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/workspace" element={<WorkspacePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </HashRouter>
  )
}

export default App
