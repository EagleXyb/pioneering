// ============================================================
// SystemSection — 通用组 · 系统设置（最小可用版）
//   1. 传输模式：http（云端）/ ipc（本地）切换
//      - 读写 localStorage['agent.transportMode']，与 transport 层约定一致
//      - 切换后提示刷新窗口生效
//   2. 运行环境：纯浏览器环境（无 window.api）时给出降级提示
//   样式复用 AboutSection 的 MenuCard + 行模式：
//   白底圆角卡 + 单行 hover #f0f0f0 + 1px 分隔线
// ============================================================

import { useState, type ReactNode } from 'react'
import { Cloud, HardDrive, MonitorSmartphone } from 'lucide-react'
import { pxToRem } from '@/lib/utils'

type TransportMode = 'http' | 'ipc'

const TRANSPORT_MODE_STORAGE_KEY = 'agent.transportMode'

function readTransportMode(): TransportMode {
  try {
    const v = window.localStorage.getItem(TRANSPORT_MODE_STORAGE_KEY)
    return v === 'ipc' ? 'ipc' : 'http'
  } catch {
    return 'http'
  }
}

export function SystemSection() {
  const [mode, setMode] = useState<TransportMode>(readTransportMode)
  const [hint, setHint] = useState<string | null>(null)

  // 纯浏览器环境（dev:browser）：无 window.api，本地运行时能力不可用
  const isBrowserOnly = typeof window !== 'undefined' && !window.api

  const selectMode = (next: TransportMode) => {
    if (next === mode) return
    setMode(next)
    try {
      window.localStorage.setItem(TRANSPORT_MODE_STORAGE_KEY, next)
      setHint('已切换，刷新窗口后生效')
    } catch {
      setHint('保存失败（localStorage 不可用）')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 传输模式卡片 */}
      <div
        className="w-full overflow-hidden"
        style={{ borderRadius: '5px', background: '#fff', border: '1px solid #f0f0f0' }}
      >
        <div
          className="flex items-center justify-between px-4 py-[13px]"
          style={{ background: '#f7f7f7' }}
        >
          <span className="text-[#262626]" style={{ fontSize: pxToRem(14) }}>传输模式</span>
          {hint && <span className="text-[#8c8c8c]" style={{ fontSize: pxToRem(12) }}>{hint}</span>}
        </div>
        <div style={{ height: 1, background: '#f0f0f0' }} aria-hidden />
        <ModeRow
          value="http"
          label="云端模式"
          desc="通过 HTTP 连接远程后端"
          icon={<Cloud className="shrink-0" size={18} stroke="#8c8c8c" strokeWidth={2} />}
          isActive={mode === 'http'}
          onSelect={() => selectMode('http')}
        />
        <div style={{ height: 1, background: '#f0f0f0' }} aria-hidden />
        <ModeRow
          value="ipc"
          label="本地模式"
          desc="通过 Electron IPC 连接本地运行时"
          icon={<HardDrive className="shrink-0" size={18} stroke="#8c8c8c" strokeWidth={2} />}
          isActive={mode === 'ipc'}
          onSelect={() => selectMode('ipc')}
        />
      </div>

      {/* 运行环境提示卡片（仅纯浏览器环境显示） */}
      {isBrowserOnly && (
        <div
          className="flex items-start gap-[10px] px-4 py-[13px] rounded-[5px]"
          style={{ background: '#fffbe6', border: '1px solid #ffe58f' }}
        >
          <MonitorSmartphone className="shrink-0" size={16} stroke="#d48806" strokeWidth={2} />
          <span className="leading-5 text-[#8c6116]" style={{ fontSize: pxToRem(13) }}>
            当前为纯浏览器环境，本地模式（IPC）等桌面端专属能力不可用；请使用桌面应用获得完整功能。
          </span>
        </div>
      )}
    </div>
  )
}

/** 模式行：图标 + 主/副文字 / 右侧选中圆点；hover 显灰色背景 */
function ModeRow({
  label,
  desc,
  icon,
  isActive,
  onSelect
}: {
  value: TransportMode
  label: string
  desc: string
  icon: ReactNode
  isActive: boolean
  onSelect: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex items-center justify-between px-4 py-[13px] cursor-pointer select-none"
      style={{
        background: hover ? '#f0f0f0' : 'transparent',
        transition: 'background-color 0.15s ease',
        outline: 'none'
      }}
    >
      <span className="flex items-center gap-[10px] min-w-0">
          {icon}
          <span className="flex flex-col min-w-0">
            <span className="text-[#262626] truncate" style={{ fontSize: pxToRem(14) }}>{label}</span>
            <span className="text-[#bfbfbf] mt-0.5 truncate" style={{ fontSize: pxToRem(12) }}>{desc}</span>
          </span>
        </span>
      {/* 选中指示：实心小圆点 */}
      <span
        className="shrink-0 rounded-full"
        style={{
          width: 8,
          height: 8,
          background: isActive ? '#1677ff' : 'transparent',
          border: isActive ? 'none' : '1px solid #d9d9d9'
        }}
        aria-hidden
      />
    </div>
  )
}
