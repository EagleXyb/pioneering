// ============================================================
// OfficialFooter — 官网底部
//
// 与现有 Footer.tsx 风格保持一致：上下分隔线 → 简洁版权 / 链接。
// 这里是官网版本（相较 AI Trends Footer），把"数据来源"移除，
// 改成"产品链接 + 法律页脚"。
// ============================================================

import { OFFICIAL_FOOTER_LINKS, OFFICIAL_SITE } from '@/lib/constants'

export function OfficialFooter() {
  const linkBase = {
    textDecoration: 'none' as const,
    transition: 'color 0.15s ease'
  }
  return (
    <footer
      className="w-full flex flex-col items-center gap-6"
      style={{ padding: '60px 120px 40px' }}
    >
      <div className="w-full h-px bg-divider" />
      <div className="w-full flex flex-wrap items-center justify-center gap-6 max-sm:gap-3">
        {OFFICIAL_FOOTER_LINKS.map((l) => (
          <a
            key={l.label}
            href={l.href}
            className="text-[13px] text-text-muted font-noto"
            style={linkBase}
          >
            {l.label}
          </a>
        ))}
      </div>
      <div className="text-[11px] text-text-dim font-noto">
        © 2026 {OFFICIAL_SITE.name} · Pioneering Desktop v0.1.0
      </div>
    </footer>
  )
}
