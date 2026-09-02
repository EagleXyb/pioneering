// ============================================================
// AboutSection（合并版 v2）—— 整合「关于 + 帮助与反馈」
// 本轮优化要点（v2）：
//   1) 删除顶部 "关于 Pioneering Pioneering Desktop AI Agent" 标题区
//   2) 全部 5 行（当前版本 / 关于 Pioneering / 帮助文档 / 意见反馈 / 联系我们）
//      合并进同一个外圆角卡片中。外卡片默认白色无边框，
//      单个行默认透明，只有 hover 时显现 #f0f0f0 灰色背景
//   3) 下方二维码区放入另一个独立圆角卡片，
//      与上一卡片宽度完全一致（两卡片同级 flex w-full 同宽）
//   调色板 / 圆角 / hover 与 HelpSection 风格保持一致：
//     row bg 默认透明 → hover #f0f0f0；行间距由外卡片统一
//     外链图标 stroke #bfbfbf；前缀图标 18×18 stroke #8c8c8c
// ============================================================

import { useState, type ReactNode } from 'react'
import {
  RefreshCw,
  CheckCircle2,
  FileText,
  MessageSquare,
  Link as LinkIcon,
  ExternalLink,
  Globe,
  XCircle,
  Info
} from 'lucide-react'

type UpdateStatus = 'idle' | 'checking' | 'latest' | 'error'

// ==================================================
// 导出主组件：两大卡片 + 法律页脚
// ==================================================
export function AboutSection() {
  return (
    <div className="flex flex-col h-full w-full overflow-y-auto pr-1">
      {/* 卡片 1：功能列表 —— 5 行全在同一个外圆角容器内 */}
      <MenuCard>
        <VersionRow />
        <Divider />
        <ActionRow
          icon={<Globe className="shrink-0" size={18} stroke="#8c8c8c" strokeWidth={2} />}
          label="关于 Pioneering"
          actionLabel="前往官网"
          external
          onClick={() => window.open('https://pioneering.example.com', '_blank', 'noopener,noreferrer')}
        />
        <Divider />
        <ActionRow
          icon={<FileText className="shrink-0" size={18} stroke="#8c8c8c" strokeWidth={2} />}
          label="帮助文档"
          actionLabel="查看文档"
          external
          onClick={() => window.open('https://example.com/docs', '_blank', 'noopener,noreferrer')}
        />
        <Divider />
        <ActionRow
          icon={<MessageSquare className="shrink-0" size={18} stroke="#8c8c8c" strokeWidth={2} />}
          label="意见反馈"
          actionLabel="填写反馈"
          onClick={() => alert('意见反馈功能正在建设中')}
        />
        <Divider />
        <ActionRow
          icon={<LinkIcon className="shrink-0" size={18} stroke="#8c8c8c" strokeWidth={2} />}
          label="联系我们"
          actionLabel="发送邮件"
          external
          onClick={() => window.open('mailto:support@example.com', '_blank')}
        />
      </MenuCard>

      {/* 卡片 2：关注我们 —— 二维码（与卡片 1 同为 w-full 同宽） */}
      <div className="mt-4">
        <SocialFollowCard />
      </div>

      {/* 法律页脚：永远最底部 */}
      <LegalFooter className="mt-6 mb-4" />
    </div>
  )
}

// ==================================================
// 布局容器：MenuCard
//   提供统一的外圆角（5px）、白色背景、1px 极浅描边（视觉定界，可按需求去掉）
//   外层 padding 由卡片统一，行内部不再需要圆角包裹彼此
// ==================================================
function MenuCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-full overflow-hidden"
      style={{
        borderRadius: '5px',
        background: '#ffffff',
        border: '1px solid #f0f0f0'
      }}
    >
      {children}
    </div>
  )
}

// ==================================================
// 行分隔线：1px #f0f0f0；首行前不渲染（调用方自行控制）
// ==================================================
function Divider() {
  return <div style={{ height: 1, background: '#f0f0f0', marginLeft: 62 }} aria-hidden />
}

// ==================================================
// 子组件 1：版本行（带 4 态检查更新按钮 + 技术栈副文字）
//   默认背景透明，只有 hover 时出现 #f0f0f0 灰色底
// ==================================================
function VersionRow() {
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [hover, setHover] = useState(false)

  const handleCheck = (e: React.MouseEvent) => {
    e.stopPropagation() // 防止冒泡触发行自身 click
    if (status === 'checking') return
    setStatus('checking')
    window.setTimeout(() => {
      const ok = Math.random() > 0.2
      setStatus(ok ? 'latest' : 'error')
      window.setTimeout(() => setStatus('idle'), 1500)
    }, 600)
  }

  return (
    <div
      className="flex items-center justify-between px-4 py-[13px] cursor-default select-none"
      style={{
        background: hover ? '#f0f0f0' : 'transparent',
        transition: 'background-color 0.15s ease'
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="flex items-center gap-[10px] min-w-0">
        <Info className="shrink-0" size={18} stroke="#8c8c8c" strokeWidth={2} />
        <span className="flex flex-col min-w-0">
          <span className="text-sm text-[#262626] truncate">当前版本 v0.1.0</span>
          <span className="text-[11px] text-[#bfbfbf] mt-0.5 truncate">
            Powered by Electron 42 · React 19 · LangGraph
          </span>
        </span>
      </span>
      <CheckUpdateButton status={status} onClick={handleCheck} />
    </div>
  )
}

// ==================================================
// 子组件 2：关注我们二维码卡片
//   宽度 w-full，与 MenuCard 同级同宽；外圆角 5px + 浅色背景
// ==================================================
function SocialFollowCard() {
  return (
    <div
      className="w-full rounded-[5px] px-6 py-5 flex flex-col items-center gap-4"
      style={{
        background: '#ffffff',
        border: '1px solid #f0f0f0'
      }}
    >
      <p className="text-sm text-[#595959] text-center">关注我们，获取实用技巧与产品最新动态</p>
      <div className="flex items-start justify-center gap-10 flex-wrap">
        <QrPlaceholder label="公众号" accent="#1677ff" />
        <QrPlaceholder label="社区频道" accent="#13c2c2" />
      </div>
    </div>
  )
}

// ==================================================
// 子组件 3：法律页脚（完整沿用 HelpSection 风格）
// ==================================================
function LegalFooter({ className = '' }: { className?: string }) {
  const linkBase = {
    textDecoration: 'none' as const,
    transition: 'color 0.15s ease'
  }
  const [hover1, setHover1] = useState(false)
  const [hover2, setHover2] = useState(false)

  return (
    <div
      className={`text-center text-[13px] select-none ${className}`}
      style={{ color: '#bfbfbf' }}
    >
      <a
        href="#"
        style={{ ...linkBase, color: hover1 ? '#595959' : '#bfbfbf' }}
        onMouseEnter={() => setHover1(true)}
        onMouseLeave={() => setHover1(false)}
        onClick={(e) => {
          e.preventDefault()
          alert('隐私政策')
        }}
      >
        隐私政策
      </a>
      <span className="mx-2" style={{ color: '#d9d9d9' }}>|</span>
      <a
        href="#"
        style={{ ...linkBase, color: hover2 ? '#595959' : '#bfbfbf' }}
        onMouseEnter={() => setHover2(true)}
        onMouseLeave={() => setHover2(false)}
        onClick={(e) => {
          e.preventDefault()
          alert('服务协议')
        }}
      >
        服务协议
      </a>
    </div>
  )
}

// ======================================================
// 原子组件 A：ActionRow —— 左图标+文字 / 右胶囊按钮(+外链箭头)
//   v2 样式：默认背景透明；hover 才显 #f0f0f0 灰色区域（满足"放上时才显示灰色背景"）
//   行内部不再自己包圆角（圆角来自 MenuCard 外容器 overflow-hidden）
//   左右间距 px-4 py-[13px] 与原 HelpSection 保持一致
// ======================================================
interface ActionRowProps {
  icon: ReactNode
  label: string
  actionLabel: string
  external?: boolean
  onClick?: () => void
}

function ActionRow({ icon, label, actionLabel, external, onClick }: ActionRowProps) {
  const [hover, setHover] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault()
          onClick()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex items-center justify-between px-4 py-[13px] cursor-pointer select-none"
      style={{
        background: hover ? '#f0f0f0' : 'transparent',
        color: '#262626',
        transition: 'background-color 0.15s ease',
        outline: 'none'
      }}
    >
      <span className="flex items-center gap-[10px] text-sm min-w-0">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center shrink-0">
        <CapsuleButton label={actionLabel} external={external} hover={hover} />
      </span>
    </div>
  )
}

// ActionRow 内嵌：胶囊按钮（WorkBuddy 样式）
function CapsuleButton({
  label,
  external,
  hover,
  disabled
}: {
  label: string
  external?: boolean
  hover?: boolean
  disabled?: boolean
}) {
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0"
      style={{
        padding: '4px 12px',
        fontSize: '13px',
        lineHeight: '20px',
        border: '1px solid',
        borderColor: hover && !disabled ? '#bfbfbf' : '#d9d9d9',
        borderRadius: '5px',
        background: disabled ? '#fafafa' : hover ? '#f5f5f5' : '#fff',
        color: disabled ? '#bfbfbf' : '#595959',
        cursor: disabled ? 'not-allowed' : 'inherit',
        transition: 'all 0.15s ease',
        userSelect: 'none'
      }}
    >
      <span>{label}</span>
      {external && (
        <ExternalLink size={12} strokeWidth={2} stroke="#bfbfbf" className="shrink-0" />
      )}
    </span>
  )
}

// ======================================================
// 原子组件 B：CheckUpdateButton —— 4 态状态机按钮
// ======================================================
function CheckUpdateButton({
  status,
  onClick
}: {
  status: UpdateStatus
  onClick: (e: React.MouseEvent) => void
}) {
  const isBusy = status === 'checking'
  const hoverRef = useState(false)
  const [hover] = hoverRef

  let text = '检查更新'
  let fgColor = '#595959'
  let IconNode: ReactNode = null

  if (status === 'checking') {
    text = '检查中...'
    IconNode = <RefreshCw size={12} strokeWidth={2} className="shrink-0 animate-spin" />
  } else if (status === 'latest') {
    text = '已是最新版本'
    fgColor = '#52c41a'
    IconNode = <CheckCircle2 size={12} strokeWidth={2} className="shrink-0" />
  } else if (status === 'error') {
    text = '检查失败，请重试'
    fgColor = '#ff4d4f'
    IconNode = <XCircle size={12} strokeWidth={2} className="shrink-0" />
  }

  return (
    <button
      type="button"
      disabled={isBusy}
      onClick={onClick}
      className="inline-flex items-center gap-1 shrink-0"
      style={{
        padding: '4px 12px',
        fontSize: '13px',
        lineHeight: '20px',
        border: '1px solid',
        borderColor: status !== 'idle'
          ? fgColor
          : hover && !isBusy
            ? '#bfbfbf'
            : '#d9d9d9',
        borderRadius: '5px',
        background: isBusy ? '#fafafa' : hover ? '#f5f5f5' : '#fff',
        color: fgColor,
        cursor: isBusy ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s ease',
        outline: 'none'
      }}
      onMouseEnter={() => hoverRef[1](true)}
      onMouseLeave={() => hoverRef[1](false)}
    >
      {IconNode}
      <span>{text}</span>
    </button>
  )
}

// ======================================================
// 原子组件 C：QrPlaceholder —— 品牌色伪二维码占位
//   120×120 外框 + 21×21 伪随机网格 + 中心品牌色 Logo 方块
//   下方 11px 文字标签
// ======================================================
function QrPlaceholder({ label, accent }: { label: string; accent: string }) {
  // 固定 seed 生成 21×21 网格，避免每次渲染抖动
  const size = 21
  const cells: boolean[][] = []
  let seed = 0
  for (let i = 0; i < label.length; i++) seed = (seed * 31 + label.charCodeAt(i)) >>> 0
  for (let r = 0; r < size; r++) {
    cells[r] = []
    for (let c = 0; c < size; c++) {
      seed = (seed * 1103515245 + 12345) >>> 0
      cells[r][c] = (seed & 1) === 1
    }
  }
  // 定位图案：三个角落 7×7 清空后重绘（标准 QR 特征）
  const clearCorner = (sr: number, sc: number) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) cells[sr + r][sc + c] = false
  }
  clearCorner(0, 0)
  clearCorner(0, size - 7)
  clearCorner(size - 7, 0)

  const cellPx = 120 / size

  return (
    <div className="flex flex-col items-center gap-2 shrink-0">
      <div
        className="rounded-[5px] p-2 border"
        style={{ background: '#fff', borderColor: '#ebebeb' }}
      >
        <svg width={120} height={120} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <rect x={0} y={0} width={120} height={120} fill="#fff" />
          {cells.map((row, r) =>
            row.map((v, c) =>
              v ? (
                <rect
                  key={`${r}-${c}`}
                  x={c * cellPx}
                  y={r * cellPx}
                  width={cellPx}
                  height={cellPx}
                  fill="#262626"
                />
              ) : null
            )
          )}
          {renderFinderPattern(0, 0, accent)}
          {renderFinderPattern(0, (size - 7) * cellPx, accent)}
          {renderFinderPattern((size - 7) * cellPx, 0, accent)}
          <rect x={48} y={48} width={24} height={24} rx={4} fill="#fff" stroke={accent} strokeWidth={1.5} />
          <rect x={54} y={54} width={12} height={12} rx={2} fill={accent} opacity={0.9} />
        </svg>
      </div>
      <span className="text-[11px]" style={{ color: '#8c8c8c' }}>{label}</span>
    </div>
  )
}

function renderFinderPattern(x: number, y: number, accent: string) {
  const s = (120 / 21) * 7
  const u = 120 / 21
  return (
    <g key={`fp-${x}-${y}`}>
      <rect x={x} y={y} width={s} height={s} fill="#262626" />
      <rect x={x + u} y={y + u} width={s - 2 * u} height={s - 2 * u} fill="#fff" />
      <rect
        x={x + 2 * u}
        y={y + 2 * u}
        width={s - 4 * u}
        height={s - 4 * u}
        fill={accent}
        opacity={0.85}
      />
    </g>
  )
}
