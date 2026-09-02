'use client'

// ============================================================
// CapabilitiesSection — 「能力」分段（行表）
//
// 选用「行表」而非「卡片网格」型布局：
// 与现有 PredictionsSection 形态相近，但行为「能力清单 / 标签 / 描述」，
// 给一种「技术规格表」式的阅读节奏，避免与 PillarsSection 视觉重复。
//
// 行结构：左侧编号徽标 + 标题/描述 + 右侧标签组。
// ============================================================

import { motion } from 'framer-motion'
import { capabilities, type Capability } from '@/data/capabilities'

function CapabilityRow({ cap, index }: { cap: Capability; index: number }) {
  return (
    <motion.div
      className="flex items-center gap-5 py-6 px-7 rounded-xl bg-card max-sm:flex-wrap"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: index * 0.08 }}
    >
      <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-accent-soft shrink-0">
        <span className="text-base font-bold text-accent">{cap.num}</span>
      </div>
      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
        <div className="text-[15px] font-medium text-text-primary font-noto">
          {cap.title}
        </div>
        <div className="text-xs text-text-muted2 font-noto">{cap.detail}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0 max-sm:w-full max-sm:flex-wrap">
        {cap.tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center px-3 py-1 rounded-full bg-accent-ight"
          >
            <span className="text-[11px] tracking-[1px] text-accent">{t}</span>
          </span>
        ))}
      </div>
    </motion.div>
  )
}

export function CapabilitiesSection() {
  return (
    <section id="capabilities" className="section">
      <div className="section-title">产品能力清单</div>
      <p className="section-subtitle">
        从研发到生产环境的全生命周期能力映射
      </p>

      <div className="w-full flex flex-col gap-4">
        {capabilities.map((cap, i) => (
          <CapabilityRow key={cap.num} cap={cap} index={i} />
        ))}
      </div>
    </section>
  )
}
