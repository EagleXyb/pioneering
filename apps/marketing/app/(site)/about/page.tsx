import type { Metadata } from 'next'
import { Breadcrumb } from '@/components/site/ui/Breadcrumb'
import { AboutHeader } from '@/components/site/sections/about/AboutHeader'
import { AboutStory } from '@/components/site/sections/about/AboutStory'
import { TeamSection } from '@/components/site/sections/about/TeamSection'
import { PartnersSection } from '@/components/site/sections/about/PartnersSection'
import { ContactSection } from '@/components/site/sections/about/ContactSection'
import { AboutFaq } from '@/components/site/sections/about/AboutFaq'

export const metadata: Metadata = {
  title: '关于我们',
  description: '品牌故事、团队、合作背书与联系方式。',
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return (
    <main>
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '关于我们' }]} />
      <AboutHeader />
      <AboutStory />
      <TeamSection />
      <PartnersSection />
      <ContactSection />
      <AboutFaq />
    </main>
  )
}
