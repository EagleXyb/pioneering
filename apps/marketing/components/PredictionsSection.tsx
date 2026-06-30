'use client'

import { motion } from 'framer-motion'
import { predictions } from '@/data/predictions'
import type { ConfidenceLevel } from '@/data/predictions'

const confidenceStyles: Record<ConfidenceLevel, { bg: string; text: string }> = {
  high: { bg: 'bg-green-bg', text: 'text-green' },
  mid: { bg: 'bg-amber-bg', text: 'text-amber' },
  low: { bg: 'bg-red-bg', text: 'text-red' },
}

export function PredictionsSection() {
  return (
    <section id="predictions" className="section">
      <div className="section-title">2026 关键预测</div>
      <p className="section-subtitle">
        基于多家顶级研究机构数据整合的五条核心判断
      </p>

      <div className="w-full flex flex-col gap-4">
        {predictions.map((p, i) => {
          const style = confidenceStyles[p.confidence]
          return (
            <motion.div
              key={p.num}
              className="flex items-center gap-5 py-6 px-7 rounded-xl bg-card max-sm:flex-wrap"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: i * 0.1 }}
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-accent-soft shrink-0">
                <span className="text-base font-bold text-accent">
                  {p.num}
                </span>
              </div>
              <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                <div className="text-[15px] font-medium text-text-primary font-noto">
                  {p.title}
                </div>
                <div className="text-xs text-text-muted2 font-noto">
                  {p.detail}
                </div>
              </div>
              <div
                className={`inline-flex items-center px-3 py-1 rounded-full shrink-0 ${style.bg}`}
              >
                <span className={`text-[11px] tracking-[1px] ${style.text}`}>
                  {p.badgeText}
                </span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
