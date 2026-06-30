'use client'

import { motion } from 'framer-motion'
import { polars } from '@/data/polar'

export function PolarSection() {
  return (
    <section id="polar" className="section">
      <div className="section-title">中美欧三极格局</div>
      <p className="section-subtitle">全球 AI 投资分布与竞争态势</p>

      <div className="w-full flex gap-5 max-lg:flex-wrap">
        {polars.map((p, i) => (
          <motion.div
            key={p.flag}
            className="flex-1 min-w-[260px] flex flex-col gap-4 p-8 rounded-2xl bg-card"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: i * 0.1 }}
          >
            <div className="text-lg font-bold text-text-primary">{p.flag}</div>
            <div className="text-5xl font-bold text-accent leading-none">
              {p.pct}
            </div>
            <div className="text-[13px] text-text-muted font-noto">
              {p.label}
            </div>
            <div className="text-xs text-text-muted2 leading-[22px] font-noto">
              {p.data}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
