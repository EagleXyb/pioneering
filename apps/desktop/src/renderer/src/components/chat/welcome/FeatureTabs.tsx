// ============================================================
// FeatureTabs — 功能标签（独立圆角按钮 · 极简风）
// ============================================================
// 样式对齐用户偏好 + 参考图：
//   - 外层无灰色胶囊容器，按钮独立分散带间距
//   - 圆角 5px（用户偏好的 rounded 交互尺寸）
//   - 纯文字标签，不挂图标
//   - 选中态：淡 accent 背景 + 稍深字色，无粗描边
//   - 未选中态：透明背景、muted 字色、细边框；hover 略强调
// ============================================================

import { cn } from '@/lib/utils'
import { WELCOME_FEATURES, type WelcomeFeature } from '@/lib/welcome/templates'

interface FeatureTabsProps {
  activeId: string
  onChange: (id: string) => void
}

export function FeatureTabs({ activeId, onChange }: FeatureTabsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {WELCOME_FEATURES.map((feat: WelcomeFeature) => {
        const isActive = activeId === feat.id
        return (
          <button
            key={feat.id}
            type="button"
            onClick={() => onChange(feat.id)}
            className={cn(
              'inline-flex items-center px-3 py-1.5 rounded-[5px] text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-accent text-foreground'
                : 'bg-transparent text-muted-foreground border border-border/50 hover:text-foreground hover:border-border/80 hover:bg-accent/40'
            )}
          >
            {feat.label}
          </button>
        )
      })}
    </div>
  )
}
