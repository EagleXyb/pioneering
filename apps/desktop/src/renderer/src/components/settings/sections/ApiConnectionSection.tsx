// ---- ApiConnectionSection ----
// 原 SettingsPage 中「API 连接」卡片内容，独立为设置弹框的一个分类区块。

import { useState } from 'react'
import { Globe, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import apiClient from '@/services/api/client'
import { cn } from '@/lib/utils'

export function ApiConnectionSection() {
  const [apiBaseUrl, setApiBaseUrl] = useState(
    apiClient.getBaseURL().replace('/api/v1', '')
  )
  const [apiStatus, setApiStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  const checkApiHealth = async () => {
    setApiStatus('loading')
    apiClient.setBaseURL(apiBaseUrl)
    try {
      const res = await apiClient.get<{ status: string }>('/health')
      setApiStatus(res.data.status === 'healthy' ? 'ok' : 'error')
    } catch {
      setApiStatus('error')
    }
  }

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
          placeholder="http://localhost:9000"
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
            'flex items-center gap-2 text-sm',
            apiStatus === 'ok' ? 'text-green-500' : 'text-red-500'
          )}
        >
          {apiStatus === 'ok' ? (
            <>
              <CheckCircle2 className="size-4" />
              API 连接正常
            </>
          ) : (
            <>
              <XCircle className="size-4" />
              API 连接失败 — 请确认后端已启动
            </>
          )}
        </div>
      )}
    </div>
  )
}
