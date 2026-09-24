import { ABOUT_STORY } from '@/data/site/about'

// 品牌故事（左：起因；右：工作方式深色卡 + 价值观卡）
export function AboutStory() {
  return (
    <section className="sec-md">
      <div className="wrap">
        <div className="grid">
          <div className="col-6">
            <h2 className="h3 mb-3">{ABOUT_STORY.title}</h2>
            {ABOUT_STORY.paras.map((p, i) => (
              <p key={i} className={i < ABOUT_STORY.paras.length - 1 ? 'body mb-4' : 'body'}>
                {p}
              </p>
            ))}
          </div>
          <div className="col-6">
            <div
              className="card"
              style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: 'var(--sp-5)' }}
            >
              <div className="eyebrow" style={{ color: '#7FC4BB' }}>
                HOW WE WORK
              </div>
              <div className="h4 mt-2" style={{ color: '#fff' }}>
                {ABOUT_STORY.howTitle}
              </div>
              <p style={{ color: 'rgba(255,255,255,.72)', fontSize: 15, lineHeight: 1.8, marginTop: 12 }}>
                {ABOUT_STORY.howBody}
              </p>
            </div>
            <div className="card mt-3">
              <div className="h4 mb-2">{ABOUT_STORY.valuesTitle}</div>
              <ul className="body" style={{ fontSize: 15, lineHeight: 2 }}>
                {ABOUT_STORY.values.map((v) => (
                  <li key={v}>· {v}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
