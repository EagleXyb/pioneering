'use client'

// ============================================================
// PolarSection — 中美欧三极格局（3 列卡片）
//
// 网格：lg 3 列，md 2 列，< md 1 列；卡片统一走全局 .card 类。
// ============================================================

import { motion } from 'framer-motion'
import { fadeUp } from '@/components/animations/fade-up'
import { polars } from '@/data/polar'

export function PolarSection() {
  return (
    <section id="polar" className="section">
      <div className="section-title">中美欧三极格局</div>
      <p className="section-subtitle">全球 AI 投资分布与竞争态势</p>

      <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {polars.map((p, i) => (
          <motion.div
            key={p.flag}
            className="card flex flex-col gap-4 p-8"
            {...fadeUp(i * 0.1)}
          >
            <div className="text-lg font-bold text-text-primary">{p.flag}</div>
            <div className="text-5xl font-bold text-accent leading-none">
              {p.pct}
            </div>
            <div className="text-[13px] text-text-muted">
              {p.label}
            </div>
            <div className="text-xs text-text-muted2 leading-[22px]">
              {p.data}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
