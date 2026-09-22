'use client'

// ============================================================
// CapabilitiesSection — 「能力」分段（行表）
//
// 「技术规格表」式阅读节奏：左编号徽标 + 标题/描述 + 右侧标签组。
// 行卡统一走全局 .card 类（含 hover 反馈），与卡片网格保持一致质感。
// ============================================================

import { motion } from 'framer-motion'
import { fadeUp } from '@/components/animations/fade-up'
import { capabilities, type Capability } from '@/data/capabilities'

function CapabilityRow({ cap, index }: { cap: Capability; index: number }) {
  return (
    <motion.div
      className="card flex items-center gap-5 py-6 px-7 max-sm:flex-wrap"
      {...fadeUp(index * 0.08)}
    >
      <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-accent-soft shrink-0">
        <span className="text-base font-bold text-accent">{cap.num}</span>
      </div>
      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
        <div className="text-[15px] font-medium text-text-primary">
          {cap.title}
        </div>
        <div className="text-xs text-text-muted2">{cap.detail}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0 max-sm:w-full max-sm:flex-wrap">
        {cap.tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center px-3 py-1 rounded-full bg-accent-soft"
          >
            <span className="text-xs tracking-[1px] text-accent">{t}</span>
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
