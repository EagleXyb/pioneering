import { COG_HEADER } from '@/data/site/cognition'

// 认知理念页首（标题 + 下载占位按钮，PDF 资源为占位链接）
export function CogHeader() {
  return (
    <section className="sec-sm">
      <div className="wrap">
        <div className="grid">
          <div className="col-8">
            <div className="eyebrow">{COG_HEADER.eyebrow}</div>
            <h1 className="h1">{COG_HEADER.title}</h1>
            <p className="lead mt-4" style={{ whiteSpace: 'pre-line' }}>
              {COG_HEADER.lead}
            </p>
          </div>
          <div className="col-4 flex items-c">
            <a href="#" className="btn btn-ink">
              {COG_HEADER.pdfCta}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
