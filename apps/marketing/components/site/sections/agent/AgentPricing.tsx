import Link from 'next/link'
import { AGENT_PRICING } from '@/data/site/agent'
import { Reveal } from '@/components/site/ui/Reveal'

// 价格（3 档 + 企业版宽卡，中间档高亮）；价格为原型占位
export function AgentPricing() {
  return (
    <section id="pricing" className="sec-md">
      <div className="wrap">
        <div className="eyebrow">{AGENT_PRICING.eyebrow}</div>
        <h2 className="h3 mb-3">{AGENT_PRICING.title}</h2>
        <p className="lead mb-8">{AGENT_PRICING.lead}</p>
        <div className="grid">
          {AGENT_PRICING.plans.map((p) => (
            <Reveal
              key={p.title}
              className="col-4"
            >
              <div
                className="card"
                style={{
                  height: '100%',
                  ...(p.featured
                    ? { borderColor: 'var(--celadon)', borderWidth: 2 }
                    : {}),
                }}
              >
                <div style={{ height: 26 }}>
                  {p.badge && <div className="tag">{p.badge}</div>}
                </div>
                <div className="h4">{p.title}</div>
                <div className="stat-num mt-2" style={{ fontSize: 32 }}>
                  {p.price}
                </div>
                <div className="small mt-2">{p.desc}</div>
                <ul className="mt-4">
                  {p.features.map((f) => (
                    <li key={f} className="body" style={{ fontSize: 15, padding: '4px 0' }}>
                      ✓ {f}
                    </li>
                  ))}
                </ul>
                <a
                  href="#try"
                  className={`btn ${p.featured ? 'btn-primary' : 'btn-ghost'} mt-4`}
                  style={{ width: '100%' }}
                >
                  {p.cta}
                </a>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="card mt-6" style={{ background: 'var(--paper)' }}>
          <div className="h4 mb-2">{AGENT_PRICING.enterprise.title}</div>
          <p className="body" style={{ fontSize: 15 }}>
            {AGENT_PRICING.enterprise.body}
          </p>
          <Link href="/about#contact" className="btn btn-ink btn-sm mt-3">
            {AGENT_PRICING.enterprise.cta}
          </Link>
        </div>
      </div>
    </section>
  )
}
