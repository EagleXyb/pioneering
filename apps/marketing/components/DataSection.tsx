'use client'

import { motion } from 'framer-motion'
import { metrics } from '@/data/metrics'

export function DataSection() {
  return (
    <section id="data" className="section">
      <div className="section-title">关键数据</div>
      <p className="section-subtitle">全球 AI 市场的核心指标一览</p>

      <div className="w-full flex gap-5 max-lg:flex-wrap">
        {metrics.map((m, i) => (
          <motion.div
            key={m.headline}
            className="flex-1 min-w-[280px] flex flex-col gap-5 p-8 rounded-2xl bg-card"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: i * 0.1 }}
          >
            <div className="text-sm text-text-muted tracking-[2px] font-noto">
              {m.headline}
            </div>
            <div className="text-[40px] font-bold text-text-primary">
              {m.value}
            </div>
            <div className="text-[13px] text-accent font-noto">{m.info}</div>
            <div className="text-[11px] text-text-muted2 font-noto">{m.src}</div>

            <div className="w-full h-1 rounded-sm bg-progress-bg overflow-hidden">
              <div
                className="h-full rounded-sm bg-accent"
                style={{ width: m.width }}
              />
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
