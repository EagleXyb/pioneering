'use client'

// ============================================================
// TrendsSection — 六大核心趋势（双列卡片）
//
// 网格：md 起两列，< md 单列；卡片统一走全局 .card 类。
// 入场动画收敛到 fadeUp 工厂。
// ============================================================

import { motion } from 'framer-motion'
import { fadeUp } from '@/components/animations/fade-up'
import { trends } from '@/data/trends'
import type { Trend } from '@/data/trends'

function TrendCard({ num, title, desc, badge, index }: Trend & { index: number }) {
  return (
    <motion.div
      className="card flex flex-col gap-4 p-7"
      {...fadeUp(index * 0.06)}
    >
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-soft">
        <span className="text-sm font-bold text-accent">{num}</span>
      </div>
      <div className="text-xl font-bold text-text-primary">{title}</div>
      <div className="text-[13px] text-text-muted leading-[22px]">
        {desc}
      </div>
      <div className="text-xs text-accent tracking-[0.5px]">
        {badge}
      </div>
    </motion.div>
  )
}

export function TrendsSection() {
  return (
    <section id="trends" className="section">
      <div className="section-title">六大核心趋势</div>
      <p className="section-subtitle">
        2025–2026 年 AI 产业正在经历的六项结构性变革
      </p>

      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-5">
        {trends.map((t, i) => (
          <TrendCard key={t.num} {...t} index={i} />
        ))}
      </div>
    </section>
  )
}
