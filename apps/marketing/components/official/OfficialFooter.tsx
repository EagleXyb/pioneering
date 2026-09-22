// ============================================================
// OfficialFooter — 官网底部
//
// 与 trends Footer 风格一致：上下分隔线 → 链接行 / 版权。
// 水平内边距走 --page-x 变量，与其他区块保持同一节奏。
// ============================================================

import { OFFICIAL_FOOTER_LINKS, OFFICIAL_SITE } from '@/lib/constants'

export function OfficialFooter() {
  return (
    <footer
      className="w-full flex flex-col items-center gap-6"
      style={{ padding: '60px var(--page-x) 40px' }}
    >
      <div className="w-full h-px bg-divider" />
      <div className="w-full flex flex-wrap items-center justify-center gap-6 max-sm:gap-3">
        {OFFICIAL_FOOTER_LINKS.map((l) => (
          <a
            key={l.label}
            href={l.href}
            className="text-[13px] text-text-muted no-underline transition-colors duration-200 hover:text-text-primary"
          >
            {l.label}
          </a>
        ))}
      </div>
      <div className="text-xs text-text-dim">
        © 2026 {OFFICIAL_SITE.name} · Pioneering Desktop v0.1.0
      </div>
    </footer>
  )
}
