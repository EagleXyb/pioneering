// ============================================================
// not-found — 404 兜底页
//
// 与营销页同样的 section/page 排版，便于从任意路径回到官网首页或趋势报告。
// ============================================================

import { OFFICIAL_SITE, SITE } from '@/lib/constants'

export const metadata = {
  title: '页面未找到'
}

export default function NotFound() {
  return (
    <div className="page">
      <header className="w-full flex justify-between items-center h-[72px] px-12 max-sm:px-5 bg-bg">
        <a
          href="/"
          className="text-xl font-bold text-text-primary tracking-[3px] no-underline"
        >
          {OFFICIAL_SITE.brand}
        </a>
      </header>
      <div className="w-full h-px bg-divider" />

      <section className="section">
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="text-6xl font-bold text-text-primary">404</div>
          <p className="text-base text-text-muted font-noto">页面未找到</p>
          <p className="max-w-[520px] text-sm text-text-muted2 text-center leading-6 font-noto">
            你访问的页面不存在或已被移动。可以从下方入口继续浏览官网内容。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
            <a
              href="/"
              className="inline-flex items-center px-5 py-2.5 rounded-[6px] bg-accent text-white text-sm font-medium no-underline transition-colors duration-200 hover:opacity-90"
            >
              返回官网首页
            </a>
            <a
              href={`${SITE.url}/trends`}
              className="inline-flex items-center px-5 py-2.5 rounded-[6px] bg-transparent border border-divider text-text-muted text-sm font-medium no-underline transition-colors duration-200 hover:text-text-primary hover:border-text-muted"
            >
              查看趋势报告
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
