// ============================================================
// FeatureTabs — 功能标签（独立圆角按钮，非胶囊Tab组）
// ============================================================
// 样式对齐 TRAE 参考图：
//   - 外层无灰色胶囊容器，按钮独立分散带间距
//   - 圆角 5px，非 full pill
//   - 无 lucide 图标，纯文字
//   - 选中态：淡色背景（bg-accent text-foreground）
// ============================================================

import { cn } from '@/lib/utils'
import { WELCOME_FEATURES, type WelcomeFeature } from '@/lib/welcome/templates'

interface FeatureTabsProps {
  activeId: string
  onChange: (id: string) => void
}

export function FeatureTabs({ activeId, onChange }: FeatureTabsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {WELCOME_FEATURES.map((feat: WelcomeFeature) => {
        const isActive = activeId === feat.id
        return (
          <button
            key={feat.id}
            onClick={() => onChange(feat.id)}
            className={cn(
              'inline-flex items-center px-3 py-1.5 rounded-[5px] text-sm font-medium transition-colors border',
              isActive
                ? 'bg-accent text-foreground border-border/60'
                : 'bg-transparent text-muted-foreground border-border/40 hover:text-foreground hover:border-border/60'
            )}
          >
            {feat.label}
          </button>
        )
      })}
    </div>
  )
}
