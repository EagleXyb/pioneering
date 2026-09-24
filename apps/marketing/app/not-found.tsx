// ============================================================
// not-found — 404 兜底页（认知品牌站浅色视觉体系）
// 独立引入 brand.css，保证直达不存在路径时样式也完整。
// ============================================================

import Link from 'next/link'
import './(site)/brand.css'
import { Logo } from '@/components/site/ui/Logo'

export const metadata = {
  title: '页面未找到',
}

export default function NotFound() {
  return (
    <div className="brand-site" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="nav">
        <div className="wrap nav-in">
          <Logo />
        </div>
      </header>
      <main className="wrap" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '96px 32px' }}>
        <div className="h1" style={{ fontSize: 72 }}>
          404
        </div>
        <h1 className="h3 mt-3">页面未找到</h1>
        <p className="body mt-3" style={{ maxWidth: 480 }}>
          你访问的页面不存在或已被移动。可以从下方入口继续浏览。
        </p>
        <div className="btn-row mt-6" style={{ justifyContent: 'center' }}>
          <Link href="/" className="btn btn-primary">
            返回首页
          </Link>
          <Link href="/agent" className="btn btn-ghost">
            体验认知陪练
          </Link>
          <Link href="/trends" className="btn btn-ghost">
            查看趋势报告
          </Link>
        </div>
      </main>
    </div>
  )
}
