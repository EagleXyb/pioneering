import { NEWSLETTER } from '@/data/site/home'

// ============================================================
// Newsletter — 订阅卡（静态演示：按钮 type=button，无提交行为）
// ============================================================

export function Newsletter() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <div
          className="card"
          style={{ padding: 'var(--sp-8)', textAlign: 'center', background: 'var(--white)' }}
        >
          <div className="eyebrow">{NEWSLETTER.eyebrow}</div>
          <h2 className="h3 mb-3">{NEWSLETTER.title}</h2>
          <p className="body mb-6" style={{ maxWidth: '32em', margin: '0 auto' }}>
            {NEWSLETTER.body}
          </p>
          <form
            className="flex gap-2 wrap-f"
            style={{ maxWidth: 460, margin: '0 auto', justifyContent: 'center' }}
          >
            <input
              type="email"
              placeholder={NEWSLETTER.placeholder}
              aria-label="邮箱地址"
              style={{
                flex: 1,
                minWidth: 220,
                height: 48,
                border: '1px solid var(--line-2)',
                borderRadius: 4,
                padding: '0 14px',
                fontSize: 16,
                fontFamily: 'inherit',
              }}
            />
            <button className="btn btn-ink" type="button">
              订阅
            </button>
          </form>
          <div className="small mt-3">{NEWSLETTER.note}</div>
        </div>
      </div>
    </section>
  )
}
