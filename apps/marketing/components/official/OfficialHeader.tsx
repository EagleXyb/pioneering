'use client'

// ============================================================
// OfficialHeader — 官网顶部导航
//
// 与现有 Header.tsx 风格保持一致：72px 高、上下分隔、内置 Logo + 锚链导航 + CTA。
// 锚链目标为页内 #pillars / #capabilities / #ecosystem / #trends。
// CTA 按钮：桌面下载 / 趋势报告两枚，分别给出两种目标。
// ============================================================

import { OFFICIAL_NAV, OFFICIAL_SITE } from '@/lib/constants'
import { PillarsLogoMark } from './PillarsLogoMark'

export function OfficialHeader() {
  return (
    <>
      <header className="w-full flex justify-between items-center h-[72px] px-12 max-sm:px-5 bg-bg">
        <a
          href="/"
          className="flex items-center gap-2.5 no-underline"
          aria-label={OFFICIAL_SITE.name}
        >
          <PillarsLogoMark size={28} />
          <span className="text-xl font-bold text-text-primary tracking-[3px]">
            {OFFICIAL_SITE.brand}
          </span>
        </a>
        <nav className="flex items-center gap-8 max-sm:gap-4">
          {OFFICIAL_NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-text-muted no-underline transition-colors duration-200 hover:text-text-primary"
            >
              {item.label}
            </a>
          ))}
          <a
            href={`${OFFICIAL_SITE.url}/trends`}
            className="text-sm text-text-muted no-underline transition-colors duration-200 hover:text-text-primary"
          >
            趋势报告
          </a>
        </nav>
      </header>
      <div className="w-full h-px bg-divider" />
    </>
  )
}
