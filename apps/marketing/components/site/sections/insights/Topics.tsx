import { TOPICS } from '@/data/site/insights'
import { Reveal } from '@/components/site/ui/Reveal'

// 专题合集（3 张琥珀标签卡），白底
export function Topics() {
  return (
    <section id="topics" className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <div className="eyebrow">{TOPICS.eyebrow}</div>
        <h2 className="h3 mb-3">{TOPICS.title}</h2>
        <p className="lead mb-8">{TOPICS.lead}</p>
        <div className="grid">
          {TOPICS.items.map((t) => (
            <Reveal key={t.title} className="col-4">
              <div className="card card-hover" style={{ height: '100%' }}>
                <div className="tag tag-amber mb-3">{t.count}</div>
                <div className="h4 mb-2">{t.title}</div>
                <p className="body" style={{ fontSize: 15 }}>
                  {t.desc}
                </p>
                <div className="small mt-3">下载专题合集 →</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
