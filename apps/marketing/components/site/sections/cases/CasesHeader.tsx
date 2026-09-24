import { CASES_HEADER } from '@/data/site/cases'

// 案例页首
export function CasesHeader() {
  return (
    <section className="sec-sm">
      <div className="wrap">
        <div className="eyebrow">{CASES_HEADER.eyebrow}</div>
        <h1 className="h1">{CASES_HEADER.title}</h1>
        <p className="lead mt-4" style={{ maxWidth: '34em' }}>
          {CASES_HEADER.lead}
        </p>
      </div>
    </section>
  )
}
