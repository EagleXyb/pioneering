'use client'

// ============================================================
// OfficialHeader — 官网顶部导航
//
// 基于 SiteHeader 统一实现（桌面锚链 + 移动端汉堡菜单），
// 本文件只负责注入官网品牌区与导航项（含「趋势报告」外链）。
// ============================================================

import { OFFICIAL_NAV, OFFICIAL_SITE } from '@/lib/constants'
import { PillarsLogoMark } from './PillarsLogoMark'
import { SiteHeader, type SiteNavLink } from '@/components/SiteHeader'

export function OfficialHeader() {
  const nav: readonly SiteNavLink[] = [
    ...OFFICIAL_NAV,
    { href: `${OFFICIAL_SITE.url}/trends`, label: '趋势报告' },
  ]

  return (
    <SiteHeader
      nav={nav}
      left={
        <a href="/" className="flex items-center gap-2.5 no-underline" aria-label={OFFICIAL_SITE.name}>
          <PillarsLogoMark size={28} />
          <span className="text-xl font-bold text-text-primary tracking-[3px]">
            {OFFICIAL_SITE.brand}
          </span>
        </a>
      }
    />
  )
}
