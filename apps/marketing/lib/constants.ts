export const SITE = {
  name: 'AI Trends',
  url: 'https://ai-trends.pioneering.dev',
  title: 'AI 发展趋势 · 2025-2026 最新趋势分析',
  description:
    '基于 Stanford HAI、McKinsey、a16z、Gartner、IDC 等全球顶级研究机构的最新数据与洞察，分析 2025–2026 年 AI 产业发展趋势。',
  locale: 'zh_CN',
  ogTitle: 'AI 发展趋势 2025-2026',
  ogDescription: '六大核心趋势、关键数据指标与2026预测',
} as const

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
