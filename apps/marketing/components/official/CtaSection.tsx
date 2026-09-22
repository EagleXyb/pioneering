'use client'

// ============================================================
// CtaSection — 官网底部行动召唤（CTA）
//
// 大卡片布局，居中：标题 / 副标题 / 两枚按钮。
// 强调处理：accent 渐变描边 + 微光斑底，与普通产品卡片拉开层级，
// 形成页面收尾的视觉高潮。
// ============================================================

import { motion } from 'framer-motion'
import { ArrowRight, FileText } from 'lucide-react'
import { fadeUp } from '@/components/animations/fade-up'
import { OFFICIAL_SITE } from '@/lib/constants'

export function CtaSection() {
  return (
    <section id="cta" className="section">
      <motion.div
        className="w-full flex flex-col items-center gap-6 py-16 px-12 max-sm:px-6 rounded-2xl border border-accent/40 shadow-glow"
        style={{
          background:
            'linear-gradient(180deg, rgba(94,106,210,0.12) 0%, #1E1E23 70%)'
        }}
        {...fadeUp()}
      >
        <h2 className="text-3xl max-sm:text-2xl font-bold text-text-primary text-center">
          开始使用 Pioneering
        </h2>
        <p className="max-w-[560px] text-sm text-text-muted text-center leading-6">
          下载桌面端即可在本地拥有完整的 AI Agent 工作流；想了解行业全景，
          可以先阅读我们整理的最新趋势报告。
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
          <a
            href={`${OFFICIAL_SITE.url}/desktop`}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-[6px] bg-accent text-white text-sm font-medium no-underline shadow-glow transition-all duration-200 hover:opacity-90 hover:-translate-y-0.5"
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
