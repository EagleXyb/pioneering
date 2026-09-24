import type { Metadata } from 'next'
import { Breadcrumb } from '@/components/site/ui/Breadcrumb'
import { AgentHeader } from '@/components/site/sections/agent/AgentHeader'
import { AgentPrinciples } from '@/components/site/sections/agent/AgentPrinciples'
import { AgentCapabilities } from '@/components/site/sections/agent/AgentCapabilities'
import { AgentSamples } from '@/components/site/sections/agent/AgentSamples'
import { AgentTry } from '@/components/site/sections/agent/AgentTry'
import { AgentLearn } from '@/components/site/sections/agent/AgentLearn'
import { AgentPricing } from '@/components/site/sections/agent/AgentPricing'
import { AgentFaq } from '@/components/site/sections/agent/AgentFaq'

export const metadata: Metadata = {
  title: '智能体',
  description: '不替你下判断，让你看清自己是怎么下判断的认知陪练智能体。',
  alternates: { canonical: '/agent' },
}

export default function AgentPage() {
  return (
    <main>
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '智能体' }]} />
      <AgentHeader />
      <AgentPrinciples />
      <AgentCapabilities />
      <AgentSamples />
      <AgentTry />
      <AgentLearn />
      <AgentPricing />
      <AgentFaq />
    </main>
  )
}
