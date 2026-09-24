import { AGENT_SAMPLES } from '@/data/site/agent'
import { Reveal } from '@/components/site/ui/Reveal'

// 真实对话样例（3 卡），白底
export function AgentSamples() {
  return (
    <section id="samples" className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <div className="eyebrow">{AGENT_SAMPLES.eyebrow}</div>
        <h2 className="h3 mb-3">{AGENT_SAMPLES.title}</h2>
        <p className="lead mb-8">{AGENT_SAMPLES.lead}</p>
        <div className="grid">
          {AGENT_SAMPLES.items.map((s) => (
            <Reveal key={s.tag} className="col-4">
              <div className="card" style={{ height: '100%' }}>
                <div className="tag mb-3">{s.tag}</div>
                <div className="body mb-3" style={{ fontSize: 15, color: 'var(--ink)' }}>
                  {s.ask}
                </div>
                <div className="hr mb-3" />
                <div className="small" style={{ color: 'var(--graphite)', lineHeight: 1.8 }}>
                  {s.answer}
                </div>
                <div className="mt-3">
                  <span
                    className="src"
                    style={{
                      fontSize: 12,
                      color: 'var(--celadon)',
                      borderBottom: '1px dashed var(--celadon)',
                    }}
                  >
                    ↳ 可点开查看依据
                  </span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
