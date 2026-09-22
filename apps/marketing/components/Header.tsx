'use client'

// ============================================================
// Header — 趋势报告（/trends）顶部导航
//
// 基于 SiteHeader 统一实现（桌面锚链 + 移动端汉堡菜单），
// 品牌区保留「返回官网」入口与 AI TRENDS 标识。
// ============================================================

import { NAV_ITEMS, OFFICIAL_SITE } from '@/lib/constants'
import { SiteHeader } from '@/components/SiteHeader'

export function Header() {
  return (
    <SiteHeader
      nav={NAV_ITEMS}
      left={
        <>
          <a
            href="/"
            className="text-xs text-text-muted2 no-underline transition-colors duration-200 hover:text-text-primary flex items-center gap-1 shrink-0"
          >
            <span aria-hidden>←</span>
            <span>返回 {OFFICIAL_SITE.brand}</span>
          </a>
          <div className="h-4 w-px bg-divider" aria-hidden />
          <div className="text-xl font-bold text-text-primary tracking-[3px]">
            AI TRENDS
          </div>
        </>
      }
    />
  )
}
