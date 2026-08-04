// ============================================================
// WelcomeScreen — 空会话欢迎引导页（拆分为上/下两部分）
// ============================================================
// 布局顺序对齐 TRAE 参考图：
//   上方：标题 → 功能标签
//   中间：输入框（由 ChatArea 渲染，不在此组件内）
//   下方：模板卡片网格
//
// 因此拆分为 WelcomeScreenTop 和 WelcomeScreenBottom 两个导出，
// ChatArea 在欢迎态将 InputArea 插入两者之间。
// ============================================================

import { useState } from 'react'
import { WelcomeHeader } from './welcome/WelcomeHeader'
import { FeatureTabs } from './welcome/FeatureTabs'
import { TemplateGallery } from './welcome/TemplateGallery'
import { DEFAULT_FEATURE_ID } from '@/lib/welcome/templates'

interface WelcomeScreenTopProps {
  /** 功能标签切换时通知底部同步 */
  onFeatureChange?: (id: string) => void
}

interface WelcomeScreenBottomProps {
  activeFeature: string
  onQuickPrompt?: (text: string) => void
}

/** 欢迎页上半部分：标题 + 功能标签 */
export function WelcomeScreenTop({ onFeatureChange }: WelcomeScreenTopProps) {
  const [activeFeature, setActiveFeature] = useState(DEFAULT_FEATURE_ID)

  const handleChange = (id: string) => {
    setActiveFeature(id)
    onFeatureChange?.(id)
  }

  return (
    <div className="w-full flex flex-col items-center gap-5 welcome-animate">
      {/* ===== 标题区 ===== */}
      <WelcomeHeader />

      {/* ===== 功能标签 ===== */}
      <FeatureTabs activeId={activeFeature} onChange={handleChange} />
    </div>
  )
}

/** 欢迎页下半部分：模板卡片网格（在输入框下方） */
export function WelcomeScreenBottom({ activeFeature, onQuickPrompt }: WelcomeScreenBottomProps) {
  return (
    <div className="w-full">
      <TemplateGallery featureId={activeFeature} onSelect={onQuickPrompt} />
    </div>
  )
}

// 保留默认导出兼容（如有其他引用）
export default WelcomeScreenTop
