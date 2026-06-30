import { DATA_SOURCES } from '@/lib/constants'

export function Footer() {
  return (
    <footer
      className="w-full flex flex-col items-center gap-8"
      style={{ padding: '60px 120px 40px' }}
    >
      <div className="w-full h-px bg-divider" />
      <div className="text-sm font-bold text-text-primary font-noto">
        数据来源
      </div>
      <div className="max-w-[800px] text-xs text-text-muted2 text-center leading-[22px] font-noto">
        {DATA_SOURCES.join(' · ')}
      </div>
      <div className="text-[11px] text-text-dim font-noto">
        © 2026 AI Trends Analysis · 数据更新至 2026 年 6 月
      </div>
    </footer>
  )
}
