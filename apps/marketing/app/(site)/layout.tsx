// ============================================================
// (site) 路由组布局 —— 认知×创新品牌站 6 页共享 chrome
// /trends 在组外，继续使用 globals.css 的深色体系，互不影响。
// ============================================================

import './brand.css'
import { SiteNav } from '@/components/site/chrome/SiteNav'
import { SiteFooter } from '@/components/site/chrome/SiteFooter'
import { FloatingAgent } from '@/components/site/chrome/FloatingAgent'
import { MobileCTA } from '@/components/site/chrome/MobileCTA'

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="brand-site">
      <SiteNav />
      {children}
      <SiteFooter />
      <FloatingAgent />
      <MobileCTA />
    </div>
  )
}
