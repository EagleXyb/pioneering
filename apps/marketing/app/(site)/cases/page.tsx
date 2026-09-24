import type { Metadata } from 'next'
import { Breadcrumb } from '@/components/site/ui/Breadcrumb'
import { CasesHeader } from '@/components/site/sections/cases/CasesHeader'
import { CaseList } from '@/components/site/sections/cases/CaseList'
import { CaseDetail } from '@/components/site/sections/cases/CaseDetail'

export const metadata: Metadata = {
  title: '案例',
  description: '可核验的真实案例：创新工作坊、认知训练营与决策陪练。',
  alternates: { canonical: '/cases' },
}

export default function CasesPage() {
  return (
    <main>
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '案例' }]} />
      <CasesHeader />
      <CaseList />
      <CaseDetail />
    </main>
  )
}
