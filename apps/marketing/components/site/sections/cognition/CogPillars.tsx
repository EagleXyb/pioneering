import { COG_PILLARS } from '@/data/site/cognition'
import { Reveal } from '@/components/site/ui/Reveal'

// 三大支柱（3 张卡，reveal）
export function CogPillars() {
  return (
    <section id="pillars" className="sec-md">
      <div className="wrap">
        <h2 className="h3 mb-2">{COG_PILLARS.title}</h2>
        <p className="lead mb-8">{COG_PILLARS.lead}</p>
        <div className="grid">
          {COG_PILLARS.items.map((p) => (
            <Reveal key={p.tag} className="col-4">
              <div className="card card-hover" style={{ height: '100%' }}>
                <div className="tag mb-3">{p.tag}</div>
                <p className="body" style={{ fontSize: 15 }}>
                  {p.desc}
                </p>
                <div className="small mt-3">{p.question}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
