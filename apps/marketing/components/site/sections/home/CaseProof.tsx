import Link from 'next/link'
import { CASE_PROOF } from '@/data/site/home'
import { Reveal } from '@/components/site/ui/Reveal'

// ============================================================
// CaseProof — 首页案例与数据（琥珀标签 + 三项指标）
// ============================================================

export function CaseProof() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <div className="grid mb-8">
          <div className="col-6">
            <div className="eyebrow">{CASE_PROOF.eyebrow}</div>
            <h2 className="h2">{CASE_PROOF.title}</h2>
          </div>
          <div className="col-6 flex wrap-f items-c" style={{ gap: 'var(--sp-6)' }}>
            {CASE_PROOF.stats.map((s) => (
              <div key={s.label}>
                <div className="stat-num num">{s.num}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid">
          {CASE_PROOF.cards.map((c) => (
            <Reveal key={c.title} className="col-4">
              <Link href="/cases" className="card card-hover" style={{ display: 'block', height: '100%' }}>
                <div className="tag tag-amber mb-3">{c.tag}</div>
                <div className="h4 mb-2">{c.title}</div>
                <p className="body" style={{ fontSize: 15 }}>
                  {c.desc}
                </p>
                <div className="small mt-3">查看完整复盘 →</div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
