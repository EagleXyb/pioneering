import Link from 'next/link'
import { CASE_DETAIL } from '@/data/site/cases'

// ============================================================
// CaseDetail — 完整复盘（STAR 四卡 + 困难与调整 + 双入口），白底
// ============================================================

export function CaseDetail() {
  const d = CASE_DETAIL
  return (
    <section id="detail" className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <div className="eyebrow">{d.eyebrow}</div>
        <h2 className="h3 mb-2">{d.title}</h2>
        <div className="flex gap-2 wrap-f mb-8">
          {d.tags.map((t) => (
            <span key={t.label} className={t.tone === 'amber' ? 'tag tag-amber' : 'tag tag-line'}>
              {t.label}
            </span>
          ))}
        </div>
        <div className="grid">
          {d.star.map((s) => (
            <div key={s.tag} className="col-6 card">
              <div className="tag mb-3">{s.tag}</div>
              <p className="body" style={{ fontSize: 15 }}>
                {s.desc}
              </p>
            </div>
          ))}
        </div>
        <div className="card mt-4" style={{ background: 'var(--paper)' }}>
          <div className="h4 mb-2">{d.difficultyTitle}</div>
          <p className="body" style={{ fontSize: 15 }}>
            {d.difficulty}
          </p>
        </div>
        <div className="flex gap-3 wrap-f mt-6">
          <Link href="/agent#try" className="btn btn-primary">
            用智能体复现这个分析 →
          </Link>
          <Link href="/cognition#concepts" className="btn btn-ghost">
            方法论出处：约束重构
          </Link>
        </div>
      </div>
    </section>
  )
}
