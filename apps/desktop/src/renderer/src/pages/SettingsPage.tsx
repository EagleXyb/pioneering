// ---- SettingsPage ----

import { useState } from 'react'
import {
  Settings,
  Globe,
  Key,
  Monitor,
  Moon,
  Sun,
  RefreshCw,
  CheckCircle2,
  XCircle
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import apiClient from '../services/api/client'
import { authService } from '../services/api/auth'

export function SettingsPage(): JSX.Element {
  const [apiBaseUrl, setApiBaseUrl] = useState(
    apiClient.getBaseURL().replace('/api/v1', '')
  )
  const [apiStatus, setApiStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [isAuthenticated, setIsAuthenticated] = useState(authService.isAuthenticated())

  // 登录表单
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  const checkApiHealth = async () => {
    setApiStatus('loading')
    apiClient.setBaseURL(apiBaseUrl) // 先应用用户输入的 URL
    try {
      const res = await apiClient.get<{ status: string }>('/health')
      setApiStatus(res.data.status === 'healthy' ? 'ok' : 'error')
    } catch {
      setApiStatus('error')
    }
  }

  const handleLogin = async () => {
    setLoginLoading(true)
    setLoginError(null)
    try {
      await authService.login({ username, password })
      setIsAuthenticated(true)
      setUsername('')
      setPassword('')
    } catch (err) {
      setLoginError(
        err instanceof Error ? err.message : 'Login failed'
      )
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = () => {
    authService.logout()
    setIsAuthenticated(false)
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Settings className="size-6" />
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        {/* API 连接 */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">API Connection</h2>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="http://localhost:9000"
              className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button size="sm" onClick={checkApiHealth} disabled={apiStatus === 'loading'}>
              <RefreshCw className={`size-4 mr-1 ${apiStatus === 'loading' ? 'animate-spin' : ''}`} />
              Test
            </Button>
          </div>

          {apiStatus !== 'idle' && (
            <div
              className={`flex items-center gap-2 text-sm ${
                apiStatus === 'ok' ? 'text-green-500' : 'text-red-500'
              }`}
            >
              {apiStatus === 'ok' ? (
                <>
                  <CheckCircle2 className="size-4" />
                  API 连接正常
                </>
              ) : apiStatus === 'error' ? (
                <>
                  <XCircle className="size-4" />
                  API 连接失败 — 请确认后端已启动
                </>
              ) : null}
            </div>
          )}
        </Card>

        {/* 认证 */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Key className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">Authentication</h2>
          </div>

          {isAuthenticated ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-500">
                <CheckCircle2 className="size-4" />
                已认证
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                Logout
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLogin()
                }}
              />
              {loginError && (
                <p className="text-sm text-red-500">{loginError}</p>
              )}
              <Button onClick={handleLogin} disabled={loginLoading}>
                {loginLoading ? (
                  <RefreshCw className="size-4 mr-1 animate-spin" />
                ) : (
                  <Key className="size-4 mr-1" />
                )}
                Login
              </Button>
            </div>
          )}
        </Card>

        {/* 外观 */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Monitor className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">Appearance</h2>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Sun className="size-4 mr-1" /> Light
            </Button>
            <Button variant="outline" size="sm">
              <Moon className="size-4 mr-1" /> Dark
            </Button>
          </div>
        </Card>

        {/* App Info */}
        <Card className="p-6 space-y-2">
          <h2 className="text-lg font-semibold">About</h2>
          <p className="text-sm text-muted-foreground">
            Pioneering Desktop AI Agent v0.1.0
          </p>
          <p className="text-sm text-muted-foreground">
            Powered by Electron 42 · React 19 · LangGraph
          </p>
        </Card>
      </div>
    </div>
  )
}
