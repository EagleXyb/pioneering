import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { RootLayout } from './layouts/RootLayout'
import { HomePage } from './pages/HomePage'
import { ChatPage } from './pages/ChatPage'
import { AgentPage } from './pages/AgentPage'
import { WorkspacePage } from './pages/WorkspacePage'
import { useAppStore } from './stores/useAppStore'
import { useSetAtom } from 'jotai'
import { platformAtom, isFullscreenAtom } from './stores/atoms'
import { normalizePlatform } from '@shared/types'
import type { MenuActionId } from '@shared/menu-template'
import type { AuthTokens } from '@shared/types'
import { appApi, storeApi } from './services/ipc'
import { apiClient } from './services/api'
import { runMenuAction } from './menu/menuActions'

// S5: Token 在主进程 storeApi 中的持久化 key
const TOKEN_STORAGE_KEY = 'auth.tokens'

function App() {
  const initTheme = useAppStore((s) => s.initTheme)
  const setPlatform = useSetAtom(platformAtom)
  const setIsFullscreen = useSetAtom(isFullscreenAtom)

  useEffect(() => {
    initTheme()
  }, [initTheme])

  // S5 修复：应用启动时从主进程 storeApi 恢复已持久化的 token，避免刷新即登出。
  // 并注册 onTokensChange 回调，token 变化时持久化到主进程内存（刷新页面不丢失）。
  useEffect(() => {
    // 恢复已持久化的 token
    void apiClient.restoreTokens(async () => {
      const tokens = await storeApi.get<AuthTokens | null>(TOKEN_STORAGE_KEY)
      return tokens ?? null
    })

    // 注册回调：token 变化时同步持久化 / 清除
    apiClient.onTokensChange((tokens) => {
      if (tokens) {
        void storeApi.set(TOKEN_STORAGE_KEY, tokens)
      } else {
        void storeApi.delete(TOKEN_STORAGE_KEY)
      }
    })
  }, [])

  // 获取平台信息，写入 platformAtom 并同步到 <html data-platform>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const override = params.get('platform')

    // 开发期预览：?platform=mac|windows|linux 优先于 IPC，
    // 在 IDE 浏览器预览中使用，无需 Electron 上下文也可生效。
    if (override === 'mac' || override === 'windows' || override === 'linux') {
      setPlatform(override)
      document.documentElement.dataset.platform = override
      return
    }

    // 无覆盖时经 IPC 获取真实平台（仅在 Electron 环境有效）
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

  // 订阅全屏态变化（macOS 全屏 / Windows F11 等）
  useEffect(() => {
    const cleanup = window.api?.window.onFullscreenChange?.((fs) => setIsFullscreen(fs))
    return () => cleanup?.()
  }, [setIsFullscreen])

  // 主进程原生菜单（macOS 全局栏）转发到渲染端的动作（如打开设置弹框）
  useEffect(() => {
    const cleanup = appApi.onMenuAction?.((id) => runMenuAction(id as MenuActionId))
    return () => cleanup?.()
  }, [])

  return (
    <HashRouter>
      <Routes>
        <Route element={<RootLayout />}>
          <Route index element={<ChatPage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
