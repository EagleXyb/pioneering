import { CASE_LIST } from '@/data/site/cases'
import { Reveal } from '@/components/site/ui/Reveal'

// 案例列表（3 张卡）：一期仅下方一份完整复盘，故卡片不做跳转，
// 避免多张不同案例卡指向同一详情的误导。
export function CaseList() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <div className="grid">
          {CASE_LIST.map((c) => (
            <Reveal key={c.title} className="col-6 col-4">
              <div className="card" style={{ display: 'block' }}>
                <div className="flex items-c gap-2 mb-3">
                  <span className="tag tag-amber">{c.tag}</span>
                  <span className="small">{c.meta}</span>
                </div>
                <div className="h4 mb-2">{c.title}</div>
                <div className="quote" style={{ fontSize: 16, paddingLeft: 12 }}>
                  {c.result}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
