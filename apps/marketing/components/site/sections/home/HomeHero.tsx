import { HERO } from '@/data/site/home'
import { Button } from '@/components/site/ui/Button'

// ============================================================
// HomeHero — 首页渐变首屏（关键词行 + 双 CTA + 四项信任数据）
// ============================================================

export function HomeHero() {
  return (
    <section className="hero">
      {/* 极光流体背景：纯 CSS 色块漂移层，样式与降级见 brand.css 第 8 节 */}
      <div className="hero-aurora" aria-hidden="true">
        <span className="blob blob-a" />
        <span className="blob blob-b" />
        <span className="blob blob-c" />
        <span className="blob blob-d" />
      </div>
      <div className="wrap hero-in">
        <div className="eyebrow">{HERO.eyebrow}</div>
        <h1>
          {HERO.titleLines[0]}
          <br />
          <span className="h1-muted">{HERO.titleLines[1]}</span>
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
          <Button href="/agent#try" variant="primary">
            免费体验智能体
          </Button>
          <Button href="/cognition" variant="ghost">
            了解认知理念
          </Button>
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
