import type { Metadata } from 'next'
import { Breadcrumb } from '@/components/site/ui/Breadcrumb'
import { InsightsHeader } from '@/components/site/sections/insights/InsightsHeader'
import { InsightsList } from '@/components/site/sections/insights/InsightsList'
import { Topics } from '@/components/site/sections/insights/Topics'
import { ArticleDetail } from '@/components/site/sections/insights/ArticleDetail'

export const metadata: Metadata = {
  title: '知识专栏',
  description: '认知科学、思维方法、创新实践与组织进化的长文专栏。',
  alternates: { canonical: '/insights' },
}

export default function InsightsPage() {
  return (
    <main>
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '知识专栏' }]} />
      <InsightsHeader />
      <InsightsList />
      <Topics />
      <ArticleDetail />
    </main>
  )
}
