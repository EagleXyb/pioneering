// ============================================================
// Header — 趋势报告（/trends）顶部导航
//
// 与 v1 视觉保持一致：72px 高 + 行内锚链导航。
// 新增「返回官网」入口（带左箭头图标）便于从 trends 回到 /。
// ============================================================

import { NAV_ITEMS, OFFICIAL_SITE } from '@/lib/constants'

export function Header() {
  return (
    <>
      <header className="w-full flex justify-between items-center h-[72px] px-12 max-sm:px-5 bg-bg">
        <div className="flex items-center gap-5">
          <a
            href="/"
            className="text-xs text-text-muted2 no-underline transition-colors duration-200 hover:text-text-primary font-noto flex items-center gap-1"
          >
            <span aria-hidden>←</span>
            <span>返回 {OFFICIAL_SITE.brand}</span>
          </a>
          <div className="h-4 w-px bg-divider" aria-hidden />
          <div className="text-xl font-bold text-text-primary tracking-[3px]">
            AI TRENDS
          </div>
        </div>
        <nav className="flex items-center gap-8 max-sm:gap-4">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-text-muted no-underline transition-colors duration-200 hover:text-text-primary"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>
      <div className="w-full h-px bg-divider" />
    </>
  )
}
