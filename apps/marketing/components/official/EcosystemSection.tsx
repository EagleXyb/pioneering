'use client'

// ============================================================
// EcosystemSection — 「产品矩阵」分段（三列列表）
//
// 三列结构：客户端 / 引擎 / 生态。每列以 column 小标开头，
// 下方给一段简介 + 子项列表。
// 卡片样式复用现有 PolarSection 的卡片样式（p-8 rounded-2xl bg-card）。
// ============================================================

import { motion } from 'framer-motion'
import { ecosystemColumns } from '@/data/ecosystem'

export function EcosystemSection() {
  return (
    <section id="ecosystem" className="section">
      <div className="section-title">产品矩阵</div>
      <p className="section-subtitle">
        三层结构覆盖从桌面端体验到智能体生态的完整工作流
      </p>

      <div className="w-full flex gap-5 max-lg:flex-wrap">
        {ecosystemColumns.map((col, i) => (
          <motion.div
            key={col.column}
            className="flex-1 min-w-[260px] flex flex-col gap-4 p-8 rounded-2xl bg-card"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: i * 0.1 }}
          >
            <div className="text-xs tracking-[2px] text-accent font-noto">
              {col.column}
            </div>
            <div className="text-lg font-bold text-text-primary">{col.title}</div>
            <p className="text-[13px] text-text-muted leading-[22px] font-noto">
              {col.desc}
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {col.items.map((it) => (
                <li
                  key={it}
                  className="flex items-start gap-2 text-[12px] text-text-muted2 font-noto"
                >
                  <span
                    className="mt-[6px] w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                    aria-hidden
                  />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
