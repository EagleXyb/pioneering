// ============================================================
// constants · /trends 趋势报告子站与跨页共用常量（单一来源）
//
// 命名约定：
//   - NAV_ITEMS / DATA_SOURCES / BRAND : AI Trends 趋势报告页（/trends）专用
//   - 品牌站（/）的站点信息统一见 data/site/site.ts；
//     /trends 页 metadata 内联在 app/trends/page.tsx
// ============================================================

/** 全站品牌（/trends 返回入口文案使用） */
export const BRAND = 'Pioneering'

// ─────────────────────────────────────────────────────────────
// AI Trends 趋势报告子站（/trends）
// ─────────────────────────────────────────────────────────────
export const NAV_ITEMS = [
  { href: '#trends', label: '趋势' },
  { href: '#data', label: '数据' },
  { href: '#polar', label: '格局' },
  { href: '#predictions', label: '预测' },
] as const

export const DATA_SOURCES = [
  'Stanford HAI 2026 AI Index Report',
  'McKinsey The State of AI 2025/2026',
  'a16z Big Ideas 2026',
  'Gartner Forecast: AI Software Revenue 2024–2028',
  'IDC Worldwide AI Spending Guide 2026',
] as const
