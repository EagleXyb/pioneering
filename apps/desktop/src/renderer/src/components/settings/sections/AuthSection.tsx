// ---- AuthSection ----
// 原 SettingsPage 中「认证」卡片内容，独立为设置弹框的一个分类区块。

import { useState } from 'react'
import { Key, RefreshCw, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authService } from '@/services/api/auth'

export function AuthSection() {
  const [isAuthenticated, setIsAuthenticated] = useState(authService.isAuthenticated())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  const handleLogin = async () => {
    setLoginLoading(true)
    setLoginError(null)
    try {
      await authService.login({ username, password })
      setIsAuthenticated(true)
      setUsername('')
      setPassword('')
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = async () => {
    await authService.logout()
    setIsAuthenticated(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Key className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">认证</h2>
      </div>

      {isAuthenticated ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-500">
            <CheckCircle2 className="size-4" />
            已认证
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            登出
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLogin()
            }}
          />
          {loginError && <p className="text-sm text-red-500">{loginError}</p>}
          <Button onClick={handleLogin} disabled={loginLoading}>
            {loginLoading ? (
              <RefreshCw className="size-4 mr-1 animate-spin" />
            ) : (
              <Key className="size-4 mr-1" />
            )}
            登录
          </Button>
        </div>
      )}
    </div>
  )
}
