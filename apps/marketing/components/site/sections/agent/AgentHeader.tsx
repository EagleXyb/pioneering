import Link from 'next/link'
import { AGENT_HEADER } from '@/data/site/agent'

// 智能体页首（左：标题与 CTA；右：深色真实对话片段卡）
export function AgentHeader() {
  const c = AGENT_HEADER
  return (
    <section className="sec-sm">
      <div className="wrap">
        <div className="grid">
          <div className="col-8">
            <div className="eyebrow">{c.eyebrow}</div>
            <h1 className="h1">
              {c.titleLines.map((line, i) => (
                <span key={i}>
                  {line}
                  {i < c.titleLines.length - 1 && <br />}
                </span>
              ))}
            </h1>
            <p className="lead mt-4" style={{ maxWidth: '34em' }}>
              {c.lead}
            </p>
            <div className="btn-row mt-6">
              <a href="#try" className="btn btn-primary">
                免注册体验 3 轮
              </a>
              <a href="#capabilities" className="btn btn-ghost">
                看它能做什么
              </a>
            </div>
          </div>
          <div className="col-4">
            <div className="card" style={{ background: 'var(--ink)', color: '#fff', border: 'none' }}>
              <div className="small" style={{ color: 'rgba(255,255,255,.6)' }}>
                {c.quoteCard.label}
              </div>
              <div className="mt-3" style={{ fontSize: 15, color: 'rgba(255,255,255,.85)' }}>
                {c.quoteCard.ask}
              </div>
              <hr className="mt-3 mb-3" style={{ border: 0, height: 1, background: 'rgba(255,255,255,.18)' }} />
              <div style={{ fontSize: 15, color: '#fff', lineHeight: 1.8 }}>
                {c.quoteCard.answerParas[0]}
                <br />
                <span style={{ color: '#7FC4BB' }}>{c.quoteCard.source}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
