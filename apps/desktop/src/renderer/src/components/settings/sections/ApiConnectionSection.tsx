// ---- ApiConnectionSection ----
// 原 SettingsPage 中「API 连接」卡片内容，独立为设置弹框的一个分类区块。
//
// 关键修复（相对原实现）：
// 1. 健康检查改用直接 fetch + 5s 超时，不再走 apiClient.get（60s 超时，后端不可达时用户等太久）。
// 2. 失败时给出具体诊断（网络错误 / HTTP 状态 / 超时 / 响应格式不符），而非笼统的「连接失败」。
// 3. 测试成功后持久化 baseURL 到 storeApi，下次启动自动恢复（M5 修复）。
// 4. 测试成功后同步到主进程（appApi.setApiBaseUrl），使 IPC APP_NETWORK_CHECK 与渲染端一致。
// 5. 组件挂载时自动探测一次，无需用户手动点「测试」。
// 6. 兼容后端响应包装：/health 经 response-wrapper 包成 { code, data:{status:'healthy'}, message }，
//    同时兼容未包装的裸 { status:'healthy' }。

import { useState, useEffect, useCallback } from 'react'
import { Globe, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import apiClient from '@/services/api/client'
import { appApi, storeApi } from '@/services/ipc'
import { cn } from '@/lib/utils'

// 持久化 baseURL 的 store key（与 App.tsx 启动恢复逻辑共用）
export const API_BASE_URL_STORAGE_KEY = 'api.baseUrl'

// 默认后端地址（与 client.ts DEFAULT_BASE_URL 一致）
// 用 127.0.0.1 而非 localhost，绕开 Windows IPv6 解析问题（详见 client.ts 注释）
// 端口 8088：避开 Chromium 不安全端口黑名单（6000 是 X11 端口，会被 ERR_UNSAFE_PORT 拦截）
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8088'

// 归一化用户输入的 baseURL：
// 1. 去尾部斜杠
// 2. 剥离遗留的 /api/v1 或 /api 前缀（TS 后端路由不带前缀）
// 3. 把 http(s)://localhost 强制改为 127.0.0.1，绕开 Windows IPv6 解析问题
//    （Fastify 默认 host=0.0.0.0 仅监听 IPv4，Chromium fetch 优先 IPv6 → 连接被拒）
// 4. 旧端口（6000/8787）→ 8088，迁移到当前安全端口
function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  // 剥离遗留的 /api/v1 或 /api 前缀（web 端 Vite proxy 模式留下的习惯）
  url = url.replace(/\/api\/v\d+$/, '').replace(/\/api$/, '')
  // localhost → 127.0.0.1，绕开 IPv6 解析不一致
  url = url.replace(/^(https?:\/\/)localhost(?=[:\/]|$)/i, '$1127.0.0.1')
  // 旧端口 6000 → 8088（6000 是 Chromium 黑名单端口，ERR_UNSAFE_PORT）
  url = url.replace(/^(https?:\/\/127\.0\.0\.1):6000(?=[:\/]|$)/i, '$1:8088')
  // 旧端口 8787 → 8088（统一迁移到当前端口）
  url = url.replace(/^(https?:\/\/127\.0\.0\.1):8787(?=[:\/]|$)/i, '$1:8088')
  return url
}

// 从后端 /health 响应中提取 status 字段，兼容包装与裸格式
function extractHealthStatus(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    // 包装格式：{ code, data: { status: 'healthy' }, message }
    if (obj.data && typeof obj.data === 'object') {
      const inner = (obj.data as Record<string, unknown>).status
      if (typeof inner === 'string') return inner
    }
    // 裸格式：{ status: 'healthy', version, ... }
    if (typeof obj.status === 'string') return obj.status
  }
  return undefined
}

type ApiStatus = 'idle' | 'loading' | 'ok' | 'error'

interface HealthCheckResult {
  ok: boolean
  /** 失败时的诊断信息 */
  detail?: string
}

// 直接 fetch /health，5s 超时。不依赖 apiClient（避免 60s 默认超时与拦截器副作用）。
async function probeHealth(baseURL: string): Promise<HealthCheckResult> {
  const base = normalizeBaseUrl(baseURL)
  if (!base) return { ok: false, detail: '地址为空' }
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, detail: '地址必须以 http:// 或 https:// 开头' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`${base}/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) {
      return { ok: false, detail: `后端返回 HTTP ${res.status}` }
    }
    const json = await res.json().catch(() => null)
    const status = extractHealthStatus(json)
    if (status !== 'healthy') {
      return {
        ok: false,
        detail: status
          ? `后端状态异常：${status}`
          : '响应格式不符（缺少 status=healthy）'
      }
    }
    return { ok: true }
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, detail: '连接超时（5s），后端可能未启动或网络不通' }
    }
    const msg = err instanceof Error ? err.message : String(err)
    // 常见 CORS / 网络错误归类
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return {
        ok: false,
        detail: '无法连接后端（网络错误或 CORS 被拒），请确认后端已启动且 CORS 配置允许本机源'
      }
    }
    return { ok: false, detail: `请求失败：${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

export function ApiConnectionSection() {
  const [apiBaseUrl, setApiBaseUrl] = useState(
    normalizeBaseUrl(apiClient.getBaseURL() || DEFAULT_API_BASE_URL)
  )
  const [apiStatus, setApiStatus] = useState<ApiStatus>('idle')
  const [errorDetail, setErrorDetail] = useState<string | null>(null)

  const checkApiHealth = useCallback(async () => {
    setApiStatus('loading')
    setErrorDetail(null)

    const testBaseURL = normalizeBaseUrl(apiBaseUrl)
    const result = await probeHealth(testBaseURL)

    if (result.ok) {
      // 测试成功才更新 apiClient 与主进程，失败时不污染（B3 修复保持）
      apiClient.setBaseURL(testBaseURL)
      void appApi.setApiBaseUrl(testBaseURL)
      // 持久化，下次启动自动恢复（M5 修复）
      void storeApi.set(API_BASE_URL_STORAGE_KEY, testBaseURL)
      setApiStatus('ok')
    } else {
      setErrorDetail(result.detail ?? '未知错误')
      setApiStatus('error')
    }
  }, [apiBaseUrl])

  // 组件挂载时自动探测一次（使用当前 apiClient 的 baseURL，不要求用户点击）
  useEffect(() => {
    void checkApiHealth()
    // 仅在挂载时执行一次；apiBaseUrl 变化时不自动重测，避免输入时频繁请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">API 连接</h2>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={apiBaseUrl}
          onChange={(e) => setApiBaseUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void checkApiHealth()
          }}
          placeholder="http://127.0.0.1:8088"
          className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="sm" onClick={checkApiHealth} disabled={apiStatus === 'loading'}>
          <RefreshCw className={cn('size-4 mr-1', apiStatus === 'loading' && 'animate-spin')} />
          测试
        </Button>
      </div>

      {apiStatus !== 'idle' && (
        <div
          className={cn(
            'flex flex-col gap-1 text-sm',
            apiStatus === 'ok' ? 'text-green-500' : 'text-red-500'
          )}
        >
          {apiStatus === 'ok' ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4" />
              API 连接正常
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <XCircle className="size-4" />
                API 连接失败 — 请确认后端已启动
              </div>
              {errorDetail && (
                <p className="ml-6 text-xs text-muted-foreground break-all">{errorDetail}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
