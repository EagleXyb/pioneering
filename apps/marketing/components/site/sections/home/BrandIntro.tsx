import Link from 'next/link'
import { BRAND_INTRO } from '@/data/site/home'

// ============================================================
// BrandIntro — 品牌定位速览（4/8 栏）
// ============================================================

export function BrandIntro() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <div className="grid">
          <div className="col-4">
            <div className="eyebrow">{BRAND_INTRO.eyebrow}</div>
            <h2 className="h2">
              {BRAND_INTRO.titleLines.map((line, i) => (
                <span key={i}>
                  {line}
                  {i < BRAND_INTRO.titleLines.length - 1 && <br />}
                </span>
              ))}
            </h2>
          </div>
          <div className="col-8">
            <p className="lead">{BRAND_INTRO.lead}</p>
            <p className="body mt-4">{BRAND_INTRO.body}</p>
            <div className="btn-row mt-4">
              <Link href="/about" className="btn btn-ghost btn-sm">
                了解品牌故事
              </Link>
              <Link href="/cognition" className="btn btn-ghost btn-sm">
                查看完整方法论
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
