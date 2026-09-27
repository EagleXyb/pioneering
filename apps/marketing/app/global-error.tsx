'use client'

// ============================================================
// global-error — root layout 自身崩溃时的最终兜底
// 此时整个 layout 被替换，不能依赖任何全局样式，使用内联样式。
// ============================================================

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FAFAFA',
          color: '#09090B',
          fontFamily:
            'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
        }}
      >
        <main style={{ textAlign: 'center', padding: '32px', maxWidth: 480 }}>
          <div style={{ fontSize: 56, fontWeight: 600, marginBottom: 16 }}>
            应用异常
          </div>
          <p style={{ color: '#52525B', lineHeight: 1.7, margin: '0 0 28px' }}>
            页面加载时发生严重错误。请尝试重新打开，或返回首页。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: '0 24px',
              borderRadius: 999,
              border: 'none',
              background: '#09090B',
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </main>
      </body>
    </html>
  )
}
