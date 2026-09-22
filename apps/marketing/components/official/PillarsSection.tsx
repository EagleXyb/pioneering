'use client'

// ============================================================
// PillarsSection — 「核心能力」分段（4 列卡片）
//
// 「图标 + 序号 + 标题 + 简介 + 要点列表」型卡片，强化"产品能力矩阵"叙事。
// 网格：lg 4 列，md 2 列，< md 1 列；卡片统一走全局 .card 类。
// ============================================================

import { motion } from 'framer-motion'
import { Bot, Layers, Cpu, ShieldCheck, type LucideIcon } from 'lucide-react'
import { fadeUp } from '@/components/animations/fade-up'
import { pillars, type PillarIconKey } from '@/data/pillars'

// 图标表：与 data/pillars.ts 的 iconKey 一一对应。
// 集中维护便于增删与保证 type-narrowing。
const ICON_MAP: Record<PillarIconKey, LucideIcon> = {
  agent: Bot,
  multimodal: Layers,
  edge: Cpu,
  governance: ShieldCheck
}

function PillarCard({
  pillar,
  index
}: {
  pillar: (typeof pillars)[number]
  index: number
}) {
  const Icon = ICON_MAP[pillar.iconKey]
  return (
    <motion.div
      className="card flex flex-col gap-4 p-7"
      {...fadeUp(index * 0.1)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-accent-soft">
          <Icon className="size-4 text-accent" strokeWidth={2.2} />
        </div>
        <span className="text-xs text-text-dim tracking-[2px]">
          {pillar.num}
        </span>
      </div>

      <div className="text-xl font-bold text-text-primary">{pillar.title}</div>

      <p className="text-[13px] text-text-muted leading-[22px]">
        {pillar.summary}
      </p>

      <ul className="mt-1 flex flex-col gap-1.5">
        {pillar.bullets.map((b) => (
          <li
            key={b}
            className="flex items-start gap-2 text-xs text-text-muted2"
          >
            <span
              className="mt-[6px] w-1.5 h-1.5 rounded-full bg-accent shrink-0"
              aria-hidden
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

export function PillarsSection() {
  return (
    <section id="pillars" className="section">
      <div className="section-title">核心能力</div>
      <p className="section-subtitle">
        四条贯穿产品全栈的能力主线，沉淀在框架、运行时与桌面端
      </p>

      <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {pillars.map((p, i) => (
          <PillarCard key={p.num} pillar={p} index={i} />
        ))}
      </div>
    </section>
  )
}
