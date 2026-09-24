import Link from 'next/link'
import { COG_CTA } from '@/data/site/cognition'

// 页尾居中 CTA
export function CogCta() {
  return (
    <section className="sec-md">
      <div className="wrap center">
        <h2 className="h3 mb-3">{COG_CTA.title}</h2>
        <p className="body mb-6">{COG_CTA.body}</p>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <Link href="/agent#try" className="btn btn-primary">
            免注册体验 3 轮
          </Link>
          <Link href="/insights" className="btn btn-ghost">
            先读点东西
          </Link>
        </div>
      </div>
    </section>
  )
}
