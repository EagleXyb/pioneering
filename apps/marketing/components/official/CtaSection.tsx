'use client'

// ============================================================
// CtaSection — 官网底部行动召唤（CTA）
//
// 大卡片布局，居中：标题 / 副标题 / 两枚按钮。
// 按钮风格：主按钮实色（accent 底）+ 次按钮描边。
// 衔接趋势报告与文档中心两个第二动作。
// ============================================================

import { motion } from 'framer-motion'
import { ArrowRight, FileText } from 'lucide-react'
import { OFFICIAL_SITE } from '@/lib/constants'

export function CtaSection() {
  return (
    <section id="cta" className="section">
      <motion.div
        className="w-full flex flex-col items-center gap-6 py-16 px-12 max-sm:px-6 rounded-2xl bg-card"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-50px' }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <h2 className="text-3xl max-sm:text-2xl font-bold text-text-primary text-center">
          开始使用 Pioneering
        </h2>
        <p className="max-w-[560px] text-sm text-text-muted text-center leading-6 font-noto">
          下载桌面端即可在本地拥有完整的 AI Agent 工作流；想了解行业全景，
          可以先阅读我们整理的最新趋势报告。
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
          <a
            href={`${OFFICIAL_SITE.url}/desktop`}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-[6px] bg-accent text-white text-sm font-medium no-underline transition-colors duration-200 hover:opacity-90"
          >
            下载桌面端
            <ArrowRight size={14} strokeWidth={2.2} />
          </a>
          <a
            href={`${OFFICIAL_SITE.url}/trends`}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-[6px] bg-transparent border border-divider text-text-muted text-sm font-medium no-underline transition-colors duration-200 hover:text-text-primary hover:border-text-muted"
          >
            <FileText size={14} strokeWidth={2} />
            查看趋势报告
          </a>
        </div>
      </motion.div>
    </section>
  )
}
