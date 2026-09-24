import { ABOUT_CONTACT } from '@/data/site/about'

// ============================================================
// ContactSection — 联系我们（左：说明 + 其他方式；右：静态演示表单）
// 表单一期无后端：提交按钮 type=button，不产生任何请求。
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
            <form className="card">
              <div className="field">
                <label>{c.form.name.label}</label>
                <input type="text" placeholder={c.form.name.placeholder} />
              </div>
              <div className="field">
                <label>{c.form.contact.label}</label>
                <input type="text" placeholder={c.form.contact.placeholder} />
              </div>
              <div className="field">
                <label>{c.form.type.label}</label>
                <select>
                  {c.form.type.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{c.form.note.label}</label>
                <textarea placeholder={c.form.note.placeholder} />
              </div>
              <button type="button" className="btn btn-primary" style={{ width: '100%' }}>
                {c.form.submit}
              </button>
              <div className="form-note">{c.form.noteText}</div>
            </form>
          </div>
        </div>
      </div>
    </section>
  )
}
