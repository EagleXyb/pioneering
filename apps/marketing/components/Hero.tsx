'use client'

import { motion } from 'framer-motion'
import { heroStats } from '@/data/stats'

export function Hero() {
  return (
    <section
      className="w-full flex flex-col items-center gap-6 animate-fade-in"
      style={{ padding: '100px 120px 60px' }}
    >
      {/* Badge */}
      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent-soft">
        <span className="w-1.5 h-1.5 rounded-full bg-accent" />
        <span className="text-xs text-text-muted tracking-[1px] font-noto">
          Stanford HAI · McKinsey · a16z · Gartner · IDC
        </span>
      </div>

      {/* Headline */}
      <h1 className="text-6xl max-lg:text-5xl max-sm:text-4xl font-bold text-text-primary text-center leading-[1.2]">
        AI 发展趋势
      </h1>
      <p className="text-2xl max-sm:text-lg text-text-muted text-center font-noto">
        2025–2026 最新趋势分析报告
      </p>
      <p className="max-w-[640px] text-sm text-text-muted2 text-center leading-6 font-noto">
        基于 Stanford HAI 2026 AI Index、McKinsey The State of AI、a16z Big
        Ideas 2026、Gartner、IDC 等全球顶级研究机构的最新数据与洞察
      </p>

      {/* Stats Bar */}
      <motion.div
        className="w-full flex justify-evenly items-center flex-wrap gap-6 py-8 px-12 max-sm:p-5 rounded-2xl"
        style={{ background: 'rgba(30,30,35,0.53)' }}
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {heroStats.map((stat) => (
          <div key={stat.label} className="flex flex-col items-center gap-1">
            <div className="text-3xl max-sm:text-2xl font-bold text-text-primary">
              {stat.value}
            </div>
            <div className="text-xs text-text-muted font-noto">{stat.label}</div>
            <div className="text-[10px] text-accent tracking-[1px]">
              {stat.source}
            </div>
          </div>
        ))}
      </motion.div>
    </section>
  )
}
