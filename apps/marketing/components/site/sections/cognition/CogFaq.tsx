import { COG_FAQ } from '@/data/site/cognition'
import { Reveal } from '@/components/site/ui/Reveal'

// 常见质疑与回应（read 宽度卡片列），白底
export function CogFaq() {
  return (
    <section id="faq" className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <h2 className="h3 mb-6">{COG_FAQ.title}</h2>
        <div className="read">
          {COG_FAQ.items.map((f) => (
            <Reveal key={f.q} className="mb-3">
              <div className="card">
                <div className="h4">{f.q}</div>
                <p className="body mt-2" style={{ fontSize: 15 }}>
                  {f.a}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
