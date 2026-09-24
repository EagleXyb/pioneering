import { AGENT_FAQ } from '@/data/site/agent'

// 智能体页常见问题（4 张两栏卡）
export function AgentFaq() {
  return (
    <section id="faq" className="sec-md">
      <div className="wrap">
        <h2 className="h3 mb-6">{AGENT_FAQ.title}</h2>
        <div className="grid">
          {AGENT_FAQ.items.map((f) => (
            <div key={f.q} className="col-6 card">
              <div className="h4 mb-2">{f.q}</div>
              <p className="body" style={{ fontSize: 15 }}>
                {f.a}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
