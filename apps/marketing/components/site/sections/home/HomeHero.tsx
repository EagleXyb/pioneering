import Link from 'next/link'
import { HERO } from '@/data/site/home'

// ============================================================
// HomeHero — 首页渐变首屏（关键词行 + 双 CTA + 四项信任数据）
// ============================================================

export function HomeHero() {
  return (
    <section className="hero">
      <div className="wrap hero-in">
        <div className="eyebrow" style={{ color: '#7FC4BB' }}>
          {HERO.eyebrow}
        </div>
        <h1>
          {HERO.titleLines[0]}
          <br />
          {HERO.titleLines[1]}
        </h1>
        <p className="sub">{HERO.sub}</p>
        <div className="kw-row">
          {HERO.keywords.map((k) => (
            <span key={k} className="kw">
              {k}
            </span>
          ))}
        </div>
        <div className="btn-row mt-6">
          <Link href="/agent#try" className="btn btn-primary">
            免费体验智能体
          </Link>
          <Link href="/cognition" className="btn btn-ghost">
            了解认知理念
          </Link>
        </div>
        <div className="trust">
          {HERO.stats.map((s) => (
            <div key={s.label}>
              <div className="stat-num num">{s.num}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
