// ============================================================
// 官网首页（/）
//
// 与现有 /trends 子站共享营销样式（globals.css 中的 section/page 等 token），
// 所有 section 组件均为 server component（无 onClick / hooks），动效只在
// 子组件（OfficialHero / PillarsSection / EcosystemSection ...）内 use client。
// ============================================================

import { OfficialHeader } from '@/components/official/OfficialHeader'
import { OfficialHero } from '@/components/official/OfficialHero'
import { PillarsSection } from '@/components/official/PillarsSection'
import { EcosystemSection } from '@/components/official/EcosystemSection'
import { CapabilitiesSection } from '@/components/official/CapabilitiesSection'
import { CtaSection } from '@/components/official/CtaSection'
import { OfficialFooter } from '@/components/official/OfficialFooter'

export default function HomePage() {
  return (
    <div className="page">
      <OfficialHeader />
      <OfficialHero />
      <PillarsSection />
      <CapabilitiesSection />
      <EcosystemSection />
      <CtaSection />
      <OfficialFooter />
    </div>
  )
}
