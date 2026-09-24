import Link from 'next/link'
import { CORE_METHOD } from '@/data/site/home'
import { Reveal } from '@/components/site/ui/Reveal'

// ============================================================
// CoreMethod — 认知模型三层（左）+ 三大支柱卡（右），白底区块
// ============================================================

export function CoreMethod() {
  return (
    <section className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <div className="grid">
          <div className="col-6">
            <div className="eyebrow">{CORE_METHOD.eyebrow}</div>
            <h2 className="h2 mb-3">{CORE_METHOD.title}</h2>
            <p className="body mb-6">{CORE_METHOD.body}</p>
            <div className="model">
              {CORE_METHOD.layers.map((l, i) => (
                <div key={l.badge}>
                  <Reveal>
                    <div className={`layer${l.on ? ' on' : ''}`}>
                      <div className="lbadge">{l.badge}</div>
                      <div>
                        <div className="lt">{l.title}</div>
                        <div className="ld">{l.desc}</div>
                      </div>
                    </div>
                  </Reveal>
                  {i < CORE_METHOD.layers.length - 1 && (
                    <div className="arrow-down">↓</div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="col-6">
            <div className="card" style={{ background: 'var(--paper)', height: '100%' }}>
              <div className="tag mb-3">三大支柱</div>
              {CORE_METHOD.pillars.map((p, i) => (
                <div key={p.title}>
                  {i > 0 && <hr className="hr mt-3 mb-3" />}
                  <div className={i === 0 ? 'h4 mt-2' : 'h4'}>{p.title}</div>
                  <p className="body" style={{ fontSize: 15 }}>
                    {p.desc}
                  </p>
                </div>
              ))}
              <div className="btn-row mt-6">
                <Link href="/cognition" className="btn btn-ink btn-sm">
                  查看完整方法论
                </Link>
                <Link href="/agent#capabilities" className="btn btn-ghost btn-sm">
                  能力对应表
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
