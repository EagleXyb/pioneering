'use client'

// ============================================================
// OfficialHero — 官网 Hero 区
//
// 复用现有 Hero 的「顶部 badge + 大标题 + 副标题 + 描述 + 数据条」结构，
// 调整文案为「Pioneering 产品定位」而非 AI Trends 报告数据。
// 视觉：hero-glow 低饱和光斑背景；水平内边距走 --page-x 变量。
// ============================================================

import { motion } from 'framer-motion'
import { fadeUp } from '@/components/animations/fade-up'
import { heroPillars } from '@/data/stats'

export function OfficialHero() {
  return (
    <section
      className="hero-glow w-full flex flex-col items-center gap-6 animate-fade-in"
      style={{ padding: '100px var(--page-x) 60px' }}
    >
      {/* Badge */}
      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent-soft">
        <span className="w-1.5 h-1.5 rounded-full bg-accent" />
        <span className="text-xs text-text-muted tracking-[1px]">
          Agent · Multimodal · Edge · Governance
        </span>
      </div>

      {/* Headline */}
      <h1 className="text-6xl max-lg:text-5xl max-sm:text-4xl font-bold text-text-primary text-center leading-[1.2]">
        Pioneering
      </h1>
      <p className="text-2xl max-sm:text-lg text-text-muted text-center">
        让 AI Agent 成为开发者的日常工作流
      </p>
      <p className="max-w-[720px] text-sm text-text-muted2 text-center leading-6">
        Pioneering 是一套面向开发者与企业团队的 AI Agent 工作台。
        从本地桌面端到云端编排引擎，统一承载大模型、多模态工具与可治理的执行链路。
      </p>

      {/* Stats Bar */}
      <motion.div
        className="w-full flex justify-evenly items-center flex-wrap gap-6 py-8 px-12 max-sm:p-5 rounded-2xl bg-card/60 backdrop-blur-sm"
        {...fadeUp()}
      >
        {heroPillars.map((stat) => (
          <div key={stat.label} className="flex flex-col items-center gap-1">
            <div className="text-3xl max-sm:text-2xl font-bold text-text-primary">
              {stat.value}
            </div>
            <div className="text-xs text-text-muted">{stat.label}</div>
            <div className="text-xs text-accent tracking-[1px]">
              {stat.source}
            </div>
          </div>
        ))}
      </motion.div>
    </section>
  )
}
