import type { Metadata } from 'next'
import { Breadcrumb } from '@/components/site/ui/Breadcrumb'
import { CogHeader } from '@/components/site/sections/cognition/CogHeader'
import { CogModel } from '@/components/site/sections/cognition/CogModel'
import { CogPillars } from '@/components/site/sections/cognition/CogPillars'
import { CogConcepts } from '@/components/site/sections/cognition/CogConcepts'
import { CogSources } from '@/components/site/sections/cognition/CogSources'
import { CogFaq } from '@/components/site/sections/cognition/CogFaq'
import { CogCta } from '@/components/site/sections/cognition/CogCta'

export const metadata: Metadata = {
  title: '认知理念',
  description: '认知模型三层结构、三大支柱、概念卡片库与可追溯的方法来源。',
  alternates: { canonical: '/cognition' },
}

export default function CognitionPage() {
  return (
    <main>
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '认知理念' }]} />
      <CogHeader />
      <CogModel />
      <CogPillars />
      <CogConcepts />
      <CogSources />
      <CogFaq />
      <CogCta />
    </main>
  )
}
