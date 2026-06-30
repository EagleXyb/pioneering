'use client'

import { motion } from 'framer-motion'
import { leftTrends, rightTrends } from '@/data/trends'
import type { Trend } from '@/data/trends'

function TrendCard({ num, title, desc, badge, index }: Trend & { index: number }) {
  return (
    <motion.div
      className="flex flex-col gap-4 p-7 rounded-2xl bg-card border border-card-border"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: index * 0.1 }}
    >
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-soft">
        <span className="text-sm font-bold text-accent">{num}</span>
      </div>
      <div className="text-xl font-bold text-text-primary">{title}</div>
      <div className="text-[13px] text-text-muted leading-[22px] font-noto">
        {desc}
      </div>
      <div className="text-[11px] text-accent tracking-[0.5px] font-noto">
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

      <div className="w-full flex gap-5 max-lg:flex-col">
        <div className="flex-1 flex flex-col gap-5">
          {leftTrends.map((t, i) => (
            <TrendCard key={t.num} {...t} index={i * 2} />
          ))}
        </div>
        <div className="flex-1 flex flex-col gap-5">
          {rightTrends.map((t, i) => (
            <TrendCard key={t.num} {...t} index={i * 2 + 1} />
          ))}
        </div>
      </div>
    </section>
  )
}
