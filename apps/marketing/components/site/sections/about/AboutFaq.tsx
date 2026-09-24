import { ABOUT_FAQ } from '@/data/site/about'

// 关于页常见问题（4 张两栏卡）
export function AboutFaq() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <h2 className="h3 mb-6">{ABOUT_FAQ.title}</h2>
        <div className="grid">
          {ABOUT_FAQ.items.map((f) => (
            <div key={f.q} className="col-6 card">
              <div className="h4 mb-2">{f.q}</div>
              <p className="body" style={{ fontSize: 15 }}>
                {f.a}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
