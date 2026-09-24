import { AGENT_PRINCIPLES } from '@/data/site/agent'

// 四项行为原则（4 卡）+ 设计理念宽卡（8 栏），白底
export function AgentPrinciples() {
  return (
    <section className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <div className="grid">
          {AGENT_PRINCIPLES.cards.map((c) => (
            <div key={c.title} className="col-4 card">
              <div className="h4 mb-2">{c.title}</div>
              <p className="body" style={{ fontSize: 15 }}>
                {c.desc}
              </p>
            </div>
          ))}
          <div
            className="col-8 card"
            style={{ background: 'var(--paper)', display: 'flex', alignItems: 'center' }}
          >
            <div>
              <div className="tag mb-2">为什么这样设计</div>
              <p className="body" style={{ fontSize: 15 }}>
                {AGENT_PRINCIPLES.rationale}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
