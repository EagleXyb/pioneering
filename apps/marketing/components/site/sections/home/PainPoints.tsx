import { PAIN_POINTS } from '@/data/site/home'
import { Reveal } from '@/components/site/ui/Reveal'

// ============================================================
// PainPoints — 四种卡住的时刻（4 张悬浮卡）
// ============================================================

export function PainPoints() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <div className="eyebrow">{PAIN_POINTS.eyebrow}</div>
        <h2 className="h2 mb-2">{PAIN_POINTS.title}</h2>
        <p className="lead mb-8">{PAIN_POINTS.lead}</p>
        <div className="grid">
          {PAIN_POINTS.cards.map((c) => (
            <Reveal key={c.title} className="col-6 col-4">
              <div className="card card-hover" style={{ height: '100%' }}>
                <div className="h4 mb-2">{c.title}</div>
                <p className="body" style={{ fontSize: 15 }}>
                  {c.desc}
                </p>
                <div className="mt-3">
                  <span className="tag tag-line">{c.tag}</span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
