import { DATA_SOURCES } from '@/lib/constants'

// ============================================================
// Footer — 趋势报告（/trends）底部
//
// 水平内边距走 --page-x 变量，与其他区块保持同一节奏。
// ============================================================

export function Footer() {
  return (
    <footer
      className="w-full flex flex-col items-center gap-8"
      style={{ padding: '60px var(--page-x) 40px' }}
    >
      <div className="w-full h-px bg-divider" />
      <div className="text-sm font-bold text-text-primary">
        数据来源
      </div>
      <div className="max-w-[800px] text-xs text-text-muted2 text-center leading-[22px]">
        {DATA_SOURCES.join(' · ')}
      </div>
      <div className="text-xs text-text-dim">
        © 2026 AI Trends Analysis · 数据更新至 2026 年 6 月
      </div>
    </footer>
  )
}
