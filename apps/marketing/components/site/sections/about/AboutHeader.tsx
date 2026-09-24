import { ABOUT_HEADER } from '@/data/site/about'

// 关于页首
export function AboutHeader() {
  return (
    <section className="sec-sm">
      <div className="wrap">
        <div className="grid">
          <div className="col-8">
            <div className="eyebrow">{ABOUT_HEADER.eyebrow}</div>
            <h1 className="h1">
              {ABOUT_HEADER.titleLines.map((line, i) => (
                <span key={i}>
                  {line}
                  {i < ABOUT_HEADER.titleLines.length - 1 && <br />}
                </span>
              ))}
            </h1>
            <p className="lead mt-4" style={{ maxWidth: '34em' }}>
              {ABOUT_HEADER.lead}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
