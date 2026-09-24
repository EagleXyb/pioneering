import Link from 'next/link'
import { FEATURED_INSIGHTS } from '@/data/site/home'
import { Reveal } from '@/components/site/ui/Reveal'

// ============================================================
// FeaturedInsights — 首页精选专栏（3 张文章卡）
// ============================================================

export function FeaturedInsights() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <div className="flex between items-c wrap-f gap-3 mb-6">
          <div>
            <div className="eyebrow">{FEATURED_INSIGHTS.eyebrow}</div>
            <h2 className="h2">{FEATURED_INSIGHTS.title}</h2>
          </div>
          <Link href="/insights" className="btn btn-ghost btn-sm">
            进入知识专栏 →
          </Link>
        </div>
        <div className="grid">
          {FEATURED_INSIGHTS.cards.map((c) => (
            <Reveal key={c.title} className="col-4">
              <Link href="/insights" className="card card-hover" style={{ display: 'block', height: '100%' }}>
                <div className="tag mb-3">{c.tag}</div>
                <div className="h4 mb-2">{c.title}</div>
                <p className="body" style={{ fontSize: 15 }}>
                  {c.desc}
                </p>
                <div className="small mt-3">{c.minutes}</div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
