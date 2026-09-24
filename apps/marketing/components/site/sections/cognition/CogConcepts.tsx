import Link from 'next/link'
import { COG_CONCEPTS } from '@/data/site/cognition'
import { Reveal } from '@/components/site/ui/Reveal'

// 概念卡片库（6 张卡，每卡内嵌自测问题 + 提问 CTA），白底
export function CogConcepts() {
  return (
    <section id="concepts" className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <h2 className="h3 mb-2">{COG_CONCEPTS.title}</h2>
        <p className="lead mb-8">{COG_CONCEPTS.lead}</p>
        <div className="grid">
          {COG_CONCEPTS.items.map((c) => (
            <Reveal key={c.title} className="col-6 col-4">
              <div className="card card-hover" style={{ height: '100%' }}>
                <div className="h4">{c.title}</div>
                <p className="body" style={{ fontSize: 15 }}>
                  {c.desc}
                </p>
                <div className="inline-agent" style={{ margin: '16px 0 0' }}>
                  <div className="t">自测问题</div>
                  <div className="q" style={{ fontSize: 14 }}>
                    {c.question}
                  </div>
                  <Link href="/agent#try" className="btn btn-primary btn-sm">
                    就这个概念提问 →
                  </Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
