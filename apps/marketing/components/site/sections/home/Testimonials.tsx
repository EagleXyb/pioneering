import { TESTIMONIALS } from '@/data/site/home'

// ============================================================
// Testimonials — 深色渐变证言区（1 张主玻璃卡 + 3 张小玻璃卡）
// ============================================================

export function Testimonials() {
  return (
    <section className="testi sec">
      <div className="wrap">
        <div className="center mb-8">
          <div className="eyebrow">{TESTIMONIALS.eyebrow}</div>
          <h2 className="h2" style={{ color: '#fff' }}>
            {TESTIMONIALS.title}
          </h2>
          <p className="small mt-2" style={{ color: 'rgba(255,255,255,.6)' }}>
            {TESTIMONIALS.sub}
          </p>
        </div>
        <div className="glass" style={{ maxWidth: 820, margin: '0 auto var(--sp-4)' }}>
          <div className="q">{TESTIMONIALS.main.quote}</div>
          <div className="who">
            <div className="avatar">{TESTIMONIALS.main.initial}</div>
            <div>
              <div className="n">{TESTIMONIALS.main.name}</div>
              <div className="r">{TESTIMONIALS.main.role}</div>
            </div>
          </div>
        </div>
        <div className="grid">
          {TESTIMONIALS.small.map((t) => (
            <div key={t.name} className="col-4 glass glass-sm">
              <div className="q" style={{ fontSize: 16 }}>
                {t.quote}
              </div>
              <div className="who">
                <div className="avatar">{t.initial}</div>
                <div>
                  <div className="n" style={{ fontSize: 14, color: '#fff' }}>
                    {t.name}
                  </div>
                  <div className="r">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
