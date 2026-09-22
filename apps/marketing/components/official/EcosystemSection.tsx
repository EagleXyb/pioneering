'use client'

// ============================================================
// EcosystemSection — 「产品矩阵」分段（三列列表）
//
// 三列结构：客户端 / 引擎 / 生态。每列以 column 小标开头，
// 下方给一段简介 + 子项列表。
// 网格：lg 3 列，md 2 列，< md 1 列；卡片统一走全局 .card 类。
// ============================================================

import { motion } from 'framer-motion'
import { fadeUp } from '@/components/animations/fade-up'
import { ecosystemColumns } from '@/data/ecosystem'

export function EcosystemSection() {
  return (
    <section id="ecosystem" className="section">
      <div className="section-title">产品矩阵</div>
      <p className="section-subtitle">
        三层结构覆盖从桌面端体验到智能体生态的完整工作流
      </p>

      <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {ecosystemColumns.map((col, i) => (
          <motion.div
            key={col.column}
            className="card flex flex-col gap-4 p-8"
            {...fadeUp(i * 0.1)}
          >
            <div className="text-xs tracking-[2px] text-accent">
              {col.column}
            </div>
            <div className="text-lg font-bold text-text-primary">{col.title}</div>
            <p className="text-[13px] text-text-muted leading-[22px]">
              {col.desc}
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {col.items.map((it) => (
                <li
                  key={it}
                  className="flex items-start gap-2 text-xs text-text-muted2"
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
