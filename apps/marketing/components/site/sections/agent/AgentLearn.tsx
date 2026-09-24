import { AGENT_LEARN } from '@/data/site/agent'
import { Reveal } from '@/components/site/ui/Reveal'

// 学习资料（4 卡），白底
export function AgentLearn() {
  return (
    <section id="learn" className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <div className="eyebrow">{AGENT_LEARN.eyebrow}</div>
        <h2 className="h3 mb-3">{AGENT_LEARN.title}</h2>
        <p className="lead mb-8">{AGENT_LEARN.lead}</p>
        <div className="grid">
          {AGENT_LEARN.items.map((l) => (
            <Reveal key={l.title} className="col-6 col-4">
              <div className="card card-hover" style={{ height: '100%' }}>
                <div className="flex between items-c mb-2">
                  <div className="h4">{l.title}</div>
                  <span className="tag tag-line">{l.meta}</span>
                </div>
                <p className="body" style={{ fontSize: 15 }}>
                  {l.desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
