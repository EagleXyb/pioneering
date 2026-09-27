import { AGENT_TRY } from '@/data/site/agent'
import { DEMO_MESSAGES } from '@/data/site/chat'
import { TryComposer } from '@/components/site/forms/TryComposer'

// ============================================================
// AgentTry — #try 体验区（左：说明 + 开头示例；右：静态对话窗口）
// 与全局 FAB 共用 DEMO_MESSAGES，保证两处演示完全一致。
// ============================================================

export function AgentTry() {
  return (
    <section id="try" className="sec-md">
      <div className="wrap">
        <div className="grid">
          <div className="col-6">
            <div className="eyebrow">{AGENT_TRY.eyebrow}</div>
            <h2 className="h3 mb-3">{AGENT_TRY.title}</h2>
            <p className="body mb-6">{AGENT_TRY.body}</p>
            <div className="card" style={{ background: 'var(--paper)' }}>
              <div className="small mb-2">{AGENT_TRY.startersLabel}</div>
              <div className="flex gap-2 wrap-f">
                {AGENT_TRY.starters.map((s) => (
                  <span key={s} className="tag">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="col-6">
            <div className="card" style={{ padding: 'var(--sp-5)' }}>
              <div className="h4 mb-4">{AGENT_TRY.windowTitle}</div>
              <div className="fab-body" style={{ padding: 0, background: 'transparent' }}>
                {DEMO_MESSAGES.map((m, i) => (
                  <div key={i} className={`msg${m.from === 'me' ? ' me' : ''}`}>
                    {m.paras.map((p, j) => (
                      <span key={j}>
                        {p}
                        {j < m.paras.length - 1 && <br />}
                      </span>
                    ))}
                    {m.source && (
                      <>
                        {' '}
                        <span className="src">↳ {m.source}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <TryComposer
                placeholder="继续聊，或留下邮箱保存上下文…"
                submitLabel="继续 · 留下邮箱保存上下文"
                note={AGENT_TRY.note}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
