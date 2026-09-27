import { AGENT_STRIP } from '@/data/site/home'
import { Reveal } from '@/components/site/ui/Reveal'
import { Button } from '@/components/site/ui/Button'
import { Card } from '@/components/site/ui/Card'

// ============================================================
// AgentStrip — 「读到哪，就能练到哪」转化条带（白底 + 纸色卡，
// 首页深色叙事仅保留 Hero 开场与 Testimonials 收尾两处）
// ============================================================

export function AgentStrip() {
  return (
    <section className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <div className="eyebrow">
          {AGENT_STRIP.eyebrow}
        </div>
        <h2 className="h2">
          {AGENT_STRIP.title}
        </h2>
        <p
          className="lead mt-3"
          style={{ maxWidth: '36em' }}
        >
          {AGENT_STRIP.lead}
        </p>
        <div className="grid mt-8">
          {AGENT_STRIP.cards.map((c) => (
            <Reveal key={c.tag} className="col-4">
              <Card
                variant="hover"
                style={{ height: '100%', background: 'var(--paper)' }}
              >
                <div className="tag mb-3">{c.tag}</div>
                <p className="body" style={{ fontSize: 15 }}>
                  {c.desc}
                </p>
                <Button href="/agent#try" variant="ghost" size="sm" className="mt-3">
                  {c.cta}
                </Button>
              </Card>
            </Reveal>
          ))}
        </div>
        <div className="btn-row mt-8">
          <Button href="/agent#try" variant="primary">
            免注册体验 3 轮
          </Button>
          <Button href="/agent" variant="ghost">
            了解智能体 →
          </Button>
        </div>
      </div>
    </section>
  )
}
