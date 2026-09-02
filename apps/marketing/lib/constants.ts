// ============================================================
// constants · 站点级常量（单一来源）
//
// 命名约定：
//   - SITE         : AI Trends 趋势报告页（/trends）专用
//                    （原首页内容迁移至 /trends，原 SITE 语义保留以兼容）
//   - OFFICIAL_*   : 官网首页（/）专用常量集合
//                    官网导航、Footer 链接、Site metadata 等
//   - 通用元数据   : BRAND / COPYRIGHT_YEAR
// ============================================================

/** 全站品牌（用于 nav logo 文案、copyright 等） */
export const BRAND = 'Pioneering'

/** 数据更新时点（全局展示使用） */
export const COPYRIGHT_YEAR = 2026

// ─────────────────────────────────────────────────────────────
// AI Trends 趋势报告子站（/trends）
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// 官网首页（/）常量集合
//
// URL 选择：对外统一走最外层域名（暂用 pioneering.ai 占位，
// 与 `apps/desktop` 中 `https://docs.pioneering.ai` 同品牌策略保持一致）。
// 实际部署如更换域名，只改 OFFICIAL_SITE.url 即可。
// ─────────────────────────────────────────────────────────────
export const OFFICIAL_SITE = {
  name: 'Pioneering 官网',
  brand: BRAND,
  /** 官网主域名（不含路径，路径前缀由调用方拼接） */
  url: 'https://pioneering.ai',
  /** 桌面端分发入口（CTA 与文档中心指向） */
  desktop: 'https://pioneering.ai/desktop',
  /** 趋势报告子域（marketing 应用 9001 端口或预发域名） */
  trends: 'https://ai-trends.pioneering.dev',
  /** SEO 元数据 */
  title: 'Pioneering · 让 AI Agent 成为开发者的日常工作流',
  description:
    'Pioneering 是一套面向开发者与企业团队的 AI Agent 工作台。本地桌面 + 云端编排引擎，承载大模型、多模态工具与可治理的执行链路。',
  ogTitle: 'Pioneering · AI Agent 工作台',
  ogDescription: '云边双模运行、多模型路由、企业级安全治理 — Pioneering 让 AI 真正进入工作流。',
  locale: 'zh_CN',
} as const

/** 官网首页顶部 nav：锚到页内各 section */
export const OFFICIAL_NAV = [
  { href: '#pillars', label: '核心能力' },
  { href: '#capabilities', label: '产品能力' },
  { href: '#ecosystem', label: '产品矩阵' },
] as const

/** 官网底部链接组：稳定中间页，href 现阶段使用 # 占位（占位路径可见） */
export const OFFICIAL_FOOTER_LINKS = [
  { label: '产品', href: '#' },
  { label: '能力', href: '#capabilities' },
  { label: '文档', href: `${OFFICIAL_SITE.url}/docs` },
  { label: '趋势报告', href: `${OFFICIAL_SITE.url}/trends` },
  { label: '隐私政策', href: '#' },
  { label: '服务协议', href: '#' },
] as const
