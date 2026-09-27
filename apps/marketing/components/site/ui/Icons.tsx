// ============================================================
// Icons · 原型内联 SVG 的 1:1 移植（无外部依赖，保持描边粗细与圆角一致）
// ============================================================

export function LogoMark({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  // 配色对齐 brand.css：zinc-950 外环 + indigo 内核（深底反白 + indigo-300）
  const outer = tone === 'dark' ? '#09090B' : '#FFFFFF'
  const mid = tone === 'dark' ? '#4F46E5' : '#A5B4FC'
  const dot = tone === 'dark' ? '#4F46E5' : '#A5B4FC'
  return (
    <svg className="logo-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="13" stroke={outer} strokeWidth="1.4" />
      <circle cx="16" cy="16" r="8" stroke={mid} strokeWidth="1.4" />
      <circle cx="16" cy="16" r="3" fill={dot} />
      {/* 刻度线仅导航版保留（原型页脚 logo 无刻度） */}
      {tone === 'dark' && (
        <path d="M16 3v6M16 23v6M3 16h6M23 16h6" stroke={outer} strokeWidth="1.4" />
      )}
    </svg>
  )
}

export function BurgerIcon() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
      <path d="M0 1h18M0 6h18M0 11h18" stroke="#09090B" strokeWidth="1.6" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1 1l14 14M15 1L1 15" stroke="#09090B" strokeWidth="1.6" />
    </svg>
  )
}

export function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5h16v11H9l-5 4V5z"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="10.5" r="1.1" fill="#fff" />
      <circle cx="12" cy="10.5" r="1.1" fill="#fff" />
      <circle cx="15" cy="10.5" r="1.1" fill="#fff" />
    </svg>
  )
}
