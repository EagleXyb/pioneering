import { COG_MODEL } from '@/data/site/cognition'

// 三层结构（左：模型图；右：用法卡），白底
export function CogModel() {
  return (
    <section id="model" className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <h2 className="h3 mb-6">{COG_MODEL.title}</h2>
        <div className="grid">
          <div className="col-8">
            <div className="model">
              {COG_MODEL.layers.map((l, i) => (
                <div key={l.badge}>
                  <div className={`layer${l.on ? ' on' : ''}`}>
                    <div className="lbadge">{l.badge}</div>
                    <div>
                      <div className="lt">{l.title}</div>
                      <div className="ld">{l.desc}</div>
                    </div>
                  </div>
                  {i < COG_MODEL.layers.length - 1 && <div className="arrow-down">↓</div>}
                </div>
              ))}
            </div>
          </div>
          <div className="col-4">
            <div className="card" style={{ background: 'var(--paper)' }}>
              <div className="h4 mb-2">{COG_MODEL.usageTitle}</div>
              {COG_MODEL.usage.map((p, i) => (
                <p
                  key={i}
                  className="body"
                  style={{ fontSize: 15, ...(i > 0 ? { marginTop: 'var(--sp-3)' } : {}) }}
                >
                  {p}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
