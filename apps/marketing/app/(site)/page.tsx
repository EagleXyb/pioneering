import type { Metadata } from 'next'
import { HomeHero } from '@/components/site/sections/home/HomeHero'
import { BrandIntro } from '@/components/site/sections/home/BrandIntro'
import { PainPoints } from '@/components/site/sections/home/PainPoints'
import { CoreMethod } from '@/components/site/sections/home/CoreMethod'
import { AgentStrip } from '@/components/site/sections/home/AgentStrip'
import { FeaturedInsights } from '@/components/site/sections/home/FeaturedInsights'
import { CaseProof } from '@/components/site/sections/home/CaseProof'
import { Testimonials } from '@/components/site/sections/home/Testimonials'
import { Newsletter } from '@/components/site/sections/home/Newsletter'

export const metadata: Metadata = {
  title: '首页',
  description: '认知×创新品牌站首页：方法论、知识专栏、智能体陪练与真实案例。',
  alternates: { canonical: '/' },
}

export default function HomePage() {
  return (
    <main>
      <HomeHero />
      <BrandIntro />
      <hr className="hr" />
      <PainPoints />
      <CoreMethod />
      <AgentStrip />
      <FeaturedInsights />
      <hr className="hr" />
      <CaseProof />
      <Testimonials />
      <Newsletter />
    </main>
  )
}
