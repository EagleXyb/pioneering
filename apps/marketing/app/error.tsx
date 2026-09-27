'use client'

// ============================================================
// error — 路由段渲染异常兜底（浅色品牌站视觉体系）
// 与 not-found 一样显式引入 brand.css，保证错误页样式完整。
// ============================================================

import { useEffect } from 'react'
import './(site)/brand.css'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // 接入监控后在此上报 error / error.digest
    console.error(error)
  }, [error])

  return (
    <div
      className="brand-site"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <main
        className="wrap"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '96px 32px',
        }}
      >
        <div className="h1" style={{ fontSize: 64 }}>
          页面出了点问题
        </div>
        <p className="body mt-3" style={{ maxWidth: 480 }}>
          渲染过程中发生错误。可以重试当前页面，或返回首页继续浏览。
        </p>
        <div className="btn-row mt-6" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={reset}>
            重试
          </button>
          <a className="btn btn-ghost" href="/">
            返回首页
          </a>
        </div>
      </main>
    </div>
  )
}
