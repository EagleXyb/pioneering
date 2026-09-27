import { FEATURED_INSIGHTS } from '@/data/site/home'
import { Reveal } from '@/components/site/ui/Reveal'
import { Button } from '@/components/site/ui/Button'
import { Card } from '@/components/site/ui/Card'

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
          <Button href="/insights" variant="ghost" size="sm">
            进入知识专栏 →
          </Button>
        </div>
        <div className="grid grid-snap">
          {FEATURED_INSIGHTS.cards.map((c) => (
            <Reveal key={c.title} className="col-4">
              <Card
                variant="link"
                href="/insights"
                style={{ display: 'block', height: '100%' }}
              >
                <div className="tag mb-3">{c.tag}</div>
                <div className="h4 mb-2">{c.title}</div>
                <p className="body" style={{ fontSize: 15 }}>
                  {c.desc}
                </p>
                <div className="small mt-3">{c.minutes}</div>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
