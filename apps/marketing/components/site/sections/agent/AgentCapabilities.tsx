import Link from 'next/link'
import { AGENT_CAPABILITIES } from '@/data/site/agent'
import { Reveal } from '@/components/site/ui/Reveal'

// 能力 × 方法论（6 张两栏卡，reveal）
export function AgentCapabilities() {
  return (
    <section id="capabilities" className="sec-md">
      <div className="wrap">
        <div className="eyebrow">{AGENT_CAPABILITIES.eyebrow}</div>
        <h2 className="h3 mb-3">{AGENT_CAPABILITIES.title}</h2>
        <p className="lead mb-8">{AGENT_CAPABILITIES.lead}</p>
        <div className="grid">
          {AGENT_CAPABILITIES.items.map((c) => (
            <Reveal key={c.title} className="col-6">
              <div className="card card-hover">
                <div className="flex between items-c">
                  <div className="h4">{c.title}</div>
                  <span className="tag tag-line">{c.method}</span>
                </div>
                <p className="body mt-2" style={{ fontSize: 15 }}>
                  {c.desc}
                </p>
                <div className="flex gap-2 wrap-f mt-3">
                  <Link href="/insights" className="small" style={{ color: 'var(--celadon)' }}>
                    方法论出处 →
                  </Link>
                  <a href="#try" className="small" style={{ color: 'var(--celadon)' }}>
                    试用这项能力 →
                  </a>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
