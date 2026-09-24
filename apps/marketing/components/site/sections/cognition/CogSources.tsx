import { COG_SOURCES } from '@/data/site/cognition'
import { Reveal } from '@/components/site/ui/Reveal'

// 方法与来源（4 张文献卡）
export function CogSources() {
  return (
    <section id="sources" className="sec-md">
      <div className="wrap">
        <div className="eyebrow">{COG_SOURCES.eyebrow}</div>
        <h2 className="h3 mb-3">{COG_SOURCES.title}</h2>
        <p className="body mb-8" style={{ maxWidth: '44em' }}>
          {COG_SOURCES.body}
        </p>
        <div className="grid">
          {COG_SOURCES.items.map((s) => (
            <Reveal key={s.work} className="col-6 col-4">
              <div className="card">
                <div className="tag tag-line mb-2">{s.author}</div>
                <div className="h4">{s.work}</div>
                <p className="small mt-2">{s.note}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
