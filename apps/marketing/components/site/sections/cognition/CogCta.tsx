import { COG_CTA } from '@/data/site/cognition'
import { Button } from '@/components/site/ui/Button'

// 页尾居中 CTA
export function CogCta() {
  return (
    <section className="sec-md">
      <div className="wrap center">
        <h2 className="h3 mb-3">{COG_CTA.title}</h2>
        <p className="body mb-6">{COG_CTA.body}</p>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <Button href="/agent#try" variant="primary">
            免注册体验 3 轮
          </Button>
          <Button href="/insights" variant="ghost">
            先读点东西
          </Button>
        </div>
      </div>
    </section>
  )
}
