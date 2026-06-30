import { Header } from '@/components/Header'
import { Hero } from '@/components/Hero'
import { TrendsSection } from '@/components/TrendsSection'
import { DataSection } from '@/components/DataSection'
import { PolarSection } from '@/components/PolarSection'
import { PredictionsSection } from '@/components/PredictionsSection'
import { Footer } from '@/components/Footer'

export default function HomePage() {
  return (
    <div className="page">
      <Header />
      <Hero />
      <TrendsSection />
      <DataSection />
      <PolarSection />
      <PredictionsSection />
      <Footer />
    </div>
  )
}
