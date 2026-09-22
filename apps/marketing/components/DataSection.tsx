'use client'

// ============================================================
// DataSection — 关键数据（3 列指标卡）
//
// 网格：lg 3 列，md 2 列，< md 1 列；卡片统一走全局 .card 类。
// ============================================================

import { motion } from 'framer-motion'
import { fadeUp } from '@/components/animations/fade-up'
import { metrics } from '@/data/metrics'

export function DataSection() {
  return (
    <section id="data" className="section">
      <div className="section-title">关键数据</div>
      <p className="section-subtitle">全球 AI 市场的核心指标一览</p>

      <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {metrics.map((m, i) => (
          <motion.div
            key={m.headline}
            className="card flex flex-col gap-5 p-8"
            {...fadeUp(i * 0.1)}
          >
            <div className="text-sm text-text-muted tracking-[2px]">
              {m.headline}
            </div>
            <div className="text-[40px] font-bold text-text-primary">
              {m.value}
            </div>
            <div className="text-[13px] text-accent">{m.info}</div>
            <div className="text-xs text-text-muted2">{m.src}</div>

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
