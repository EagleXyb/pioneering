import { ARTICLES } from '@/data/site/insights'
import { Reveal } from '@/components/site/ui/Reveal'

// 文章列表（6 张两栏卡，一期锚点跳同页文章详情）
export function InsightsList() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <div className="grid">
          {ARTICLES.map((a) => (
            <Reveal key={a.title} className="col-6">
              <a href="#article" className="card card-hover" style={{ display: 'block', height: '100%' }}>
                <div className="flex items-c gap-2 mb-3">
                  <span className="tag">{a.tag}</span>
                  <span className="small">{a.date}</span>
                </div>
                <div className="h4 mb-2">{a.title}</div>
                <p className="body" style={{ fontSize: 15 }}>
                  {a.desc}
                </p>
                <div className="small mt-3">{a.minutes}</div>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
