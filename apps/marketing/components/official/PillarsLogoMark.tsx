'use client'

// ============================================================
// PillarsLogoMark — 官网 Logo SVG
//
// 含义：四瓣 / 象限图形，象征桌面端 / 模型 / 工具 / 治理 四个象限，
//      中央一处高亮色块代表 Agent 调度核心。
// 用法：<PillarsLogoMark size={28} />，strokeColor / accentColor 允许覆盖。
// ============================================================

interface PillarsLogoMarkProps {
  size?: number
  strokeColor?: string
  accentColor?: string
}

export function PillarsLogoMark({
  size = 28,
  strokeColor = '#94A3B8',
  accentColor = '#5E6AD2'
}: PillarsLogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x={2} y={2} width={28} height={28} rx={7} fill="rgba(94,106,210,0.10)" />
      <rect x={6} y={6} width={8} height={8} rx={2} fill="none" stroke={strokeColor} strokeWidth={1.4} />
      <rect x={18} y={6} width={8} height={8} rx={2} fill="none" stroke={strokeColor} strokeWidth={1.4} />
      <rect x={6} y={18} width={8} height={8} rx={2} fill="none" stroke={strokeColor} strokeWidth={1.4} />
      <rect x={18} y={18} width={8} height={8} rx={2} fill={accentColor} opacity={0.9} />
    </svg>
  )
}
