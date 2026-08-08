import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { RootLayout } from './layouts/RootLayout'
import { HomePage } from './pages/HomePage'
import { ChatPage } from './pages/ChatPage'
import { WorkspacePage } from './pages/WorkspacePage'
import { AssistantPage } from './pages/AssistantPage'
import { PluginsPage } from './pages/PluginsPage'
import { AutomationPage } from './pages/AutomationPage'
import { MyFilesPage } from './pages/MyFilesPage'
import { MorePage } from './pages/MorePage'
import { useAppStore } from './stores/useAppStore'
import { useAtomValue, useSetAtom } from 'jotai'
import { platformAtom, isFullscreenAtom } from './stores/atoms'
import { normalizePlatform } from '@shared/types'
import type { MenuActionId } from '@shared/menu-template'
import { appApi, storeApi } from './services/ipc'
import { apiClient } from './services/api'
import { runMenuAction } from './menu/menuActions'
import { useAuthBootstrap } from './hooks/useAuthBootstrap'

// API baseURL 持久化 key（与 ApiConnectionSection 共用）
const API_BASE_URL_STORAGE_KEY = 'api.baseUrl'

function App() {
  const initTheme = useAppStore((s) => s.initTheme)
  const setPlatform = useSetAtom(platformAtom)
  const setIsFullscreen = useSetAtom(isFullscreenAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)

  // 认证态引导：恢复 token、拉取用户资料、订阅 token 变化。
  // 统一在此处完成，避免各组件自行判断登录态而产生竞态。
  useAuthBootstrap()

  useEffect(() => {
    initTheme()
  }, [initTheme])

  // 启动时恢复持久化的 API baseURL，并同步到主进程。
  // 解决原实现 baseURL 仅存于 apiClient 内存、重启即丢失的问题（M5 修复）。
  // 必须在 token 恢复与其他 API 调用之前完成，确保后续请求使用正确的基础地址。
  useEffect(() => {
    void (async () => {
      const saved = await storeApi.get<string>(API_BASE_URL_STORAGE_KEY)
      if (typeof saved === 'string' && saved.trim()) {
        // 归一化：
        // 1. 剥离尾部斜杠与遗留 /api 前缀
        // 2. localhost → 127.0.0.1，绕开 Windows IPv6 解析问题
        // 3. 旧端口（6000/8787）→ 8088，迁移到当前安全端口
        const normalized = saved
          .trim()
          .replace(/\/+$/, '')
          .replace(/\/api\/v\d+$/, '')
          .replace(/\/api$/, '')
          .replace(/^(https?:\/\/)localhost(?=[:\/]|$)/i, '$1127.0.0.1')
          .replace(/^(https?:\/\/127\.0\.0\.1):6000(?=[:\/]|$)/i, '$1:8088')
          .replace(/^(https?:\/\/127\.0\.0\.1):8787(?=[:\/]|$)/i, '$1:8088')
        apiClient.setBaseURL(normalized)
        // 同步到主进程，使 APP_NETWORK_CHECK 与渲染端一致
        void appApi.setApiBaseUrl(normalized)
      }
    })()
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

  // 同步全屏状态到 <html data-fullscreen>，驱动 layout-tokens.css 中的变量切换
  useEffect(() => {
    document.documentElement.dataset.fullscreen = isFullscreen ? 'true' : 'false'
  }, [isFullscreen])

  // 主进程原生菜单（macOS 全局栏）转发到渲染端的动作（如打开设置弹框）
  useEffect(() => {
    const cleanup = appApi.onMenuAction?.((id) => runMenuAction(id as MenuActionId))
    return () => cleanup?.()
  }, [])

  return (
    <TooltipProvider delayDuration={200}>
      {/* 全局自定义确认弹窗（替换系统 window.confirm）；通过 confirmDialogAtom 触发 */}
      <ConfirmDialog />
      <HashRouter>
        <Routes>
          <Route element={<RootLayout />}>
            <Route index element={<ChatPage />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/workspace" element={<WorkspacePage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/plugins" element={<PluginsPage />} />
            <Route path="/skills" element={<Navigate to="/plugins" replace />} />
            <Route path="/automation" element={<AutomationPage />} />
            <Route path="/my-files" element={<MyFilesPage />} />
            <Route path="/more" element={<MorePage />} />
          </Route>
        </Routes>
      </HashRouter>
    </TooltipProvider>
  )
}

export default App
