import { CORE_METHOD } from '@/data/site/home'
import { MethodLayers } from '@/components/site/ui/MethodLayers'
import { Button } from '@/components/site/ui/Button'
import { Card } from '@/components/site/ui/Card'

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
            <MethodLayers layers={CORE_METHOD.layers} />
          </div>
          <div className="col-6">
            <Card
              style={{
                background: 'var(--paper)',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div className="tag mb-3" style={{ alignSelf: 'flex-start' }}>
                三大支柱
              </div>
              {CORE_METHOD.pillars.map((p, i) => (
                <div key={p.title}>
                  {i > 0 && <hr className="hr" style={{ margin: '24px 0' }} />}
                  <div className="h4">{p.title}</div>
                  <p className="body" style={{ fontSize: 15 }}>
                    {p.desc}
                  </p>
                </div>
              ))}
              {/* 等高卡中按钮沉底；paddingTop 保证堆叠（卡片不拉伸）时仍有 sp-6 间距 */}
              <div
                className="btn-row"
                style={{ marginTop: 'auto', paddingTop: 'var(--sp-6)' }}
              >
                <Button href="/cognition" variant="ink" size="sm">
                  查看完整方法论
                </Button>
                <Button href="/agent#capabilities" variant="ghost" size="sm">
                  能力对应表
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  )
}
