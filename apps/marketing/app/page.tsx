import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { TrendsSection } from '@/components/TrendsSection';
import { DataSection } from '@/components/DataSection';
import { PolarSection } from '@/components/PolarSection';
import { PredictionsSection } from '@/components/PredictionsSection';
import { Footer } from '@/components/Footer';
import ScrollAnimationProvider from '@/components/ScrollAnimationProvider';

export default function HomePage() {
  return (
    <div className="page">
      <Header />
      <ScrollAnimationProvider>
        <Hero />
        <TrendsSection />
        <DataSection />
        <PolarSection />
        <PredictionsSection />
      </ScrollAnimationProvider>
      <Footer />
    </div>
  );
}
