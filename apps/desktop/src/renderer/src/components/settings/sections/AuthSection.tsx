// ---- AuthSection ----
// 原 SettingsPage 中「认证」卡片内容，独立为设置弹框的一个分类区块。

import { useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Key, RefreshCw, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authService } from '@/services/api/auth'
import {
  authViewAtom,
  authStatusAtom,
  authErrorAtom,
  currentUserAtom,
  cachedUserAtom,
  toAppUser,
  toErrorMessage
} from '@/stores/authStore'

export function AuthSection() {
  // 登录态改为读取全局 authStore，不再维护局部副本，
  // 避免与侧边栏出现「一处已登录、一处未登录」的不一致。
  const { isAuthed, user } = useAtomValue(authViewAtom)
  const setStatus = useSetAtom(authStatusAtom)
  const setAuthError = useSetAtom(authErrorAtom)
  const setUser = useSetAtom(currentUserAtom)
  const setCachedUser = useSetAtom(cachedUserAtom)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  const handleLogin = async () => {
    setLoginLoading(true)
    setLoginError(null)
    try {
      // 登录响应本身已带完整 user，直接落地全局态，
      // 无需再请求一次 /user/profile。
      const tokens = await authService.login({ username, password })
      if (tokens.user) {
        const appUser = toAppUser(tokens.user)
        setUser(appUser)
        setCachedUser(appUser)
      }
      setAuthError(null)
      setStatus('authed')
      setUsername('')
      setPassword('')
    } catch (err) {
      setLoginError(toErrorMessage(err))
    } finally {
      setLoginLoading(false)
    }
  }

  // 登出后的状态重置由 authStore 订阅 token 变化统一完成
  const handleLogout = async () => {
    await authService.logout()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Key className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">认证</h2>
      </div>

      {isAuthed ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-500">
            <CheckCircle2 className="size-4" />
            已认证
            <span className="text-muted-foreground">
              （{user.nickname || user.username}）
            </span>
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
