import { ABOUT_PARTNERS } from '@/data/site/about'
import { Reveal } from '@/components/site/ui/Reveal'

// 合作与背书（6 张匿名机构卡）
export function PartnersSection() {
  return (
    <section id="partners" className="sec-md">
      <div className="wrap">
        <div className="eyebrow">{ABOUT_PARTNERS.eyebrow}</div>
        <h2 className="h3 mb-8">{ABOUT_PARTNERS.title}</h2>
        <div className="grid">
          {ABOUT_PARTNERS.names.map((n) => (
            <Reveal key={n} className="col-6 col-4">
              <div className="card center">
                <div className="h4">{n}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
