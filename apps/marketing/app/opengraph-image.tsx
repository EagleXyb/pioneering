import { ImageResponse } from 'next/og'

// ============================================================
// opengraph-image — 社交分享图（1200×630，构建期生成）
//
// 使用 next/og 内置字体（仅拉丁字形），故文案只用英文品牌标识，
// 避免中文渲染为豆腐块；后续自托管中文字体后可补中文标语。
// ============================================================

export const alt = 'COGNILAB · Cognition × Innovation'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: '#FAFAFA',
          color: '#09090B',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '999px',
              background: '#4F46E5',
            }}
          />
          <div
            style={{
              fontSize: '30px',
              fontWeight: 700,
              letterSpacing: '0.28em',
            }}
          >
            COGNILAB
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: '84px',
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}
          >
            <span>Cognition</span>
            <span style={{ color: '#71717A' }}>× Innovation</span>
          </div>
          <div
            style={{
              width: '120px',
              height: '6px',
              borderRadius: '999px',
              background: '#4F46E5',
            }}
          />
        </div>

        <div style={{ fontSize: '28px', color: '#71717A' }}>cognilab.com</div>
      </div>
    ),
    size,
  )
}
