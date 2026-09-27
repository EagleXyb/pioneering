import { ABOUT_CONTACT } from '@/data/site/about'
import { ContactForm } from '@/components/site/forms/ContactForm'

// ============================================================
// ContactSection — 联系我们（左：说明 + 其他方式；右：四态表单）
// 表单一期无后端：仅前端校验与模拟提交，不产生任何请求。
// ============================================================

export function ContactSection() {
  const c = ABOUT_CONTACT
  return (
    <section id="contact" className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <div className="grid">
          <div className="col-6">
            <div className="eyebrow">{c.eyebrow}</div>
            <h2 className="h3 mb-3">{c.title}</h2>
            <p className="body mb-6">{c.body}</p>
            <div className="card" style={{ background: 'var(--paper)' }}>
              <div className="h4 mb-3">{c.otherTitle}</div>
              <div className="body" style={{ fontSize: 15, lineHeight: 2.2 }}>
                {c.other.map((line, i) => (
                  <span key={i}>
                    {line}
                    {i < c.other.length - 1 && <br />}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="col-6">
            <ContactForm form={c.form} />
          </div>
        </div>
      </div>
    </section>
  )
}
