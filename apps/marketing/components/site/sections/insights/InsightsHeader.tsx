import { INSIGHTS_HEADER } from '@/data/site/insights'

// 知识专栏页首（标题 + 分类标签行；标签为静态展示，筛选为二期能力）
export function InsightsHeader() {
  return (
    <section className="sec-sm">
      <div className="wrap">
        <div className="eyebrow">{INSIGHTS_HEADER.eyebrow}</div>
        <h1 className="h1">{INSIGHTS_HEADER.title}</h1>
        <p className="lead mt-4" style={{ maxWidth: '34em' }}>
          {INSIGHTS_HEADER.lead}
        </p>
        <div className="flex gap-2 wrap-f mt-6">
          {INSIGHTS_HEADER.filters.map((f, i) => (
            <span key={f} className={i === 0 ? 'tag' : 'tag tag-line'}>
              {f}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
