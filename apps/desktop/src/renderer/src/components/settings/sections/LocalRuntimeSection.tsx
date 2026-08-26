// ---- LocalRuntimeSection ----
// 云边双模阶段 2：本地运行时密钥配置。
//   LLM / Tavily 密钥经主进程 safeStorage 加密落 electron-store，
//   每次 Agent run 前注入主进程 process.env（优先级高于 .env）。
//   明文永不回传渲染端：本区块只展示掩码值，编辑时整值重写。
//
//   preload 不可用（纯浏览器 dev）时展示降级提示。

import { useCallback, useEffect, useState } from 'react'
import { HardDrive, Lock, ShieldCheck, RefreshCw, Cloud, Cpu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  getAgentTransportMode,
  setAgentTransportMode,
  type AgentTransportMode
} from '@/services/transport'
import { isLocalChatAvailable } from '@/services/localChat'
import type {
  SecureKeyDescriptor,
  SecureKeyInfo,
  SecureKeySetResult
} from '@shared/ipc-channels'

interface KeyRowState {
  /** 输入框值（仅编辑态有内容） */
  draft: string
  saving: boolean
  error: string | null
}

export function LocalRuntimeSection() {
  const [descriptors, setDescriptors] = useState<SecureKeyDescriptor[]>([])
  const [keyInfos, setKeyInfos] = useState<Record<string, SecureKeyInfo>>({})
  const [rows, setRows] = useState<Record<string, KeyRowState>>({})
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 云边双模阶段 2：全局运行模式（云端 http / 本地 ipc），切换持久化到 localStorage
  const [mode, setMode] = useState<AgentTransportMode>(() => getAgentTransportMode())
  const localAvailable = isLocalChatAvailable()

  const handleModeChange = (next: AgentTransportMode) => {
    if (next === mode) return
    setAgentTransportMode(next)
    setMode(next)
  }

  const isAvailable =
    typeof window !== 'undefined' && !!window.api?.secureKeys

  const refresh = useCallback(async () => {
    if (!isAvailable) {
      setUnavailable(true)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const result = await window.api.secureKeys.list()
      setDescriptors(result.descriptors ?? [])
      const infoMap: Record<string, SecureKeyInfo> = {}
      for (const info of result.keys ?? []) infoMap[info.name] = info
      setKeyInfos(infoMap)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [isAvailable])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setRow = (name: string, patch: Partial<KeyRowState>) => {
    setRows((prev) => {
      const cur: KeyRowState = prev[name] ?? { draft: '', saving: false, error: null }
      return { ...prev, [name]: { ...cur, ...patch } }
    })
  }

  const handleSave = async (name: string) => {
    const row = rows[name]
    const value = (row?.draft ?? '').trim()
    if (!isAvailable) return
    setRow(name, { saving: true, error: null })
    try {
      const res: SecureKeySetResult = await window.api.secureKeys.set({ name, value })
      if (!res.ok) {
        setRow(name, { saving: false, error: res.error ?? '保存失败' })
        return
      }
      setRow(name, { draft: '', saving: false, error: null })
      await refresh()
    } catch (err) {
      setRow(name, { saving: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleClear = async (name: string) => {
    if (!isAvailable) return
    setRow(name, { saving: true, error: null })
    try {
      const res = await window.api.secureKeys.delete(name)
      if (!res.ok) {
        setRow(name, { saving: false, error: res.error ?? '清除失败' })
        return
      }
      setRow(name, { draft: '', saving: false, error: null })
      await refresh()
    } catch (err) {
      setRow(name, { saving: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (unavailable) {
    return (
      <div className="space-y-4">
        <SectionHeader />
        <p className="text-sm text-muted-foreground">
          当前环境不支持本地密钥管理（需在 Electron 桌面应用中使用）。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <SectionHeader />

      {/* 运行模式切换：云端 / 本地 */}
      <div className="space-y-2">
        <p className="text-sm font-medium">运行模式</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleModeChange('http')}
            aria-pressed={mode === 'http'}
            className={cn(
              'flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors',
              mode === 'http'
                ? 'border-primary bg-primary/5'
                : 'border-input hover:bg-muted/40'
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Cloud className="size-4" />
              云端
            </span>
            <span className="text-xs text-muted-foreground">
              会话走 HTTP 请求后端 Agent 服务
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('ipc')}
            aria-pressed={mode === 'ipc'}
            disabled={!localAvailable}
            className={cn(
              'flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors',
              mode === 'ipc'
                ? 'border-primary bg-primary/5'
                : 'border-input hover:bg-muted/40',
              !localAvailable && 'opacity-60 cursor-not-allowed'
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Cpu className="size-4" />
              本地
            </span>
            <span className="text-xs text-muted-foreground">
              会话走 IPC 主进程内嵌 Agent，断网可用
            </span>
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          切换后对<strong>新创建</strong>的会话生效；现有会话保持原归属。
        </p>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        本地运行时的 LLM 与搜索密钥经系统密钥库（Windows DPAPI / macOS
        Keychain）加密存储，仅在主进程内解密注入，云端模式不读取。留空保存即可清除。
      </p>

      {loadError && <p className="text-sm text-red-500">加载失败：{loadError}</p>}

      {loading && descriptors.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-4">
          {descriptors.map((desc) => {
            const info = keyInfos[desc.name]
            const configured = !!info?.masked
            const row = rows[desc.name] ?? { draft: '', saving: false, error: null }
            const canSave = row.saving || row.draft.trim() === ''
            return (
              <div
                key={desc.name}
                className="space-y-2 rounded-md border border-input p-3"
              >
                {/* 标签行：名称 + 已配置态 */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{desc.label}</span>
                  <span className="text-xs text-muted-foreground font-mono">{desc.name}</span>
                  {configured ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-xs rounded-md px-1.5 py-0.5',
                        info.encrypted
                          ? 'text-green-600 bg-green-50'
                          : 'text-muted-foreground bg-muted'
                      )}
                    >
                      {info.encrypted ? (
                        <ShieldCheck className="size-3" />
                      ) : (
                        <Lock className="size-3" />
                      )}
                      {info.masked}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">未配置</span>
                  )}
                </div>

                {/* 编辑行 */}
                <div className="flex gap-2">
                  <input
                    type={desc.sensitive ? 'password' : 'text'}
                    value={row.draft}
                    onChange={(e) => setRow(desc.name, { draft: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !canSave) void handleSave(desc.name)
                    }}
                    placeholder={configured ? '输入新值覆盖' : desc.placeholder}
                    autoComplete="off"
                    className="flex-1 px-3 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSave(desc.name)}
                    disabled={canSave}
                  >
                    {row.saving ? (
                      <RefreshCw className="size-4 mr-1 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-4 mr-1" />
                    )}
                    保存
                  </Button>
                  {configured && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleClear(desc.name)}
                      disabled={row.saving}
                    >
                      清除
                    </Button>
                  )}
                </div>

                {row.error && (
                  <p className="text-xs text-red-500">{row.error}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SectionHeader() {
  return (
    <div className="flex items-center gap-2">
      <HardDrive className="size-5 text-primary" />
      <h2 className="text-lg font-semibold">本地运行时</h2>
    </div>
  )
}
