import Link from 'next/link'
import { AGENT_STRIP } from '@/data/site/home'
import { Reveal } from '@/components/site/ui/Reveal'

// ============================================================
// AgentStrip — 深色渐变「读到哪，就能练到哪」条带（全站两处渐变之二）
// ============================================================

export function AgentStrip() {
  return (
    <section
      className="sec-md"
      style={{ background: 'linear-gradient(135deg,#12203A 0%,#1B3A44 100%)', color: '#fff' }}
    >
      <div className="wrap">
        <div className="eyebrow" style={{ color: '#7FC4BB' }}>
          {AGENT_STRIP.eyebrow}
        </div>
        <h2 className="h2" style={{ color: '#fff' }}>
          {AGENT_STRIP.title}
        </h2>
        <p
          className="lead mt-3"
          style={{ color: 'rgba(255,255,255,.75)', maxWidth: '36em' }}
        >
          {AGENT_STRIP.lead}
        </p>
        <div className="grid mt-8">
          {AGENT_STRIP.cards.map((c) => (
            <Reveal key={c.tag} className="col-4">
              <div className="card card-hover" style={{ height: '100%' }}>
                <div className="tag mb-3">{c.tag}</div>
                <p className="body" style={{ fontSize: 15 }}>
                  {c.desc}
                </p>
                <Link href="/agent#try" className="btn btn-ghost btn-sm mt-3">
                  {c.cta}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="btn-row mt-8">
          <Link href="/agent#try" className="btn btn-primary">
            免注册体验 3 轮
          </Link>
          <Link
            href="/agent"
            className="btn btn-ghost"
            style={{ borderColor: 'rgba(255,255,255,.35)', color: '#fff' }}
          >
            了解智能体 →
          </Link>
        </div>
      </div>
    </section>
  )
}
