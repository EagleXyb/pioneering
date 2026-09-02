// ============================================================
// /trends 子路由 —— AI Trends 趋势报告
//
// 历史背景：原 marketing 应用首页即 AI Trends 趋势报告，
// v2 重构后将官网首页（产品定位）迁移至 /，原趋势报告内容下沉为 /trends。
// 本文件保留原 / 内容（含 Header / Hero / Trends / Data / Polar / Predictions / Footer），
// 仅在 Header 上追加「返回官网」链接便于用户回到 /。
// ============================================================

import { Header } from '@/components/Header'
import { Hero } from '@/components/Hero'
import { TrendsSection } from '@/components/TrendsSection'
import { DataSection } from '@/components/DataSection'
import { PolarSection } from '@/components/PolarSection'
import { PredictionsSection } from '@/components/PredictionsSection'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'AI 发展趋势 · 2025-2026 趋势报告',
  description:
    '基于 Stanford HAI / McKinsey / a16z / Gartner / IDC 的最新数据，分析 2025–2026 AI 产业六大趋势与关键预测。',
}

export default function TrendsPage() {
  return (
    <div className="page">
      <Header />
      <Hero />
      <TrendsSection />
      <DataSection />
      <PolarSection />
      <PredictionsSection />
      <Footer />
    </div>
  )
}
