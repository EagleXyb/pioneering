import { NEWSLETTER } from '@/data/site/home'
import { NewsletterForm } from '@/components/site/forms/NewsletterForm'

// ============================================================
// Newsletter — 订阅卡（四态表单，一期无后端仅前端校验与模拟提交）
// ============================================================

export function Newsletter() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <div
          className="card newsletter-card"
          style={{ textAlign: 'center', background: 'var(--white)' }}
        >
          <div className="eyebrow">{NEWSLETTER.eyebrow}</div>
          <h2 className="h3 mb-2">{NEWSLETTER.title}</h2>
          <p
            className="body mb-4"
            style={{
              maxWidth: '34em',
              marginLeft: 'auto',
              marginRight: 'auto',
              textWrap: 'balance',
            }}
          >
            {NEWSLETTER.body}
          </p>
          <NewsletterForm
            placeholder={NEWSLETTER.placeholder}
            note={NEWSLETTER.note}
          />
        </div>
      </div>
    </section>
  )
}
