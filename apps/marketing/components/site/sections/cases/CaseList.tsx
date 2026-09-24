import { CASE_LIST } from '@/data/site/cases'
import { Reveal } from '@/components/site/ui/Reveal'

// 案例列表（3 张卡，一期锚点到同页详情）
export function CaseList() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <div className="grid">
          {CASE_LIST.map((c) => (
            <Reveal key={c.title} className="col-6 col-4">
              <a href="#detail" className="card card-hover" style={{ display: 'block' }}>
                <div className="flex items-c gap-2 mb-3">
                  <span className="tag tag-amber">{c.tag}</span>
                  <span className="small">{c.meta}</span>
                </div>
                <div className="h4 mb-2">{c.title}</div>
                <div className="quote" style={{ fontSize: 16, paddingLeft: 12 }}>
                  {c.result}
                </div>
                <div className="small mt-3">查看完整复盘 →</div>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
