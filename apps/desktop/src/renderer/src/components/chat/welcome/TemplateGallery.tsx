// ============================================================
// TemplateGallery — 模板卡片画廊（横向排列）
// ============================================================
// 布局对齐 TRAE 参考图：
//   - 左上方引导文字："不知道做什么，试试最佳实践案例"
//   - 卡片横向排列（响应式，换行显示）
//   - 每个卡片：上方大缩略图（4:3）+ 下方标题
//   - 卡片间有合适间距
// ============================================================

import { TemplateCard } from './TemplateCard'
import { TEMPLATES_BY_FEATURE } from '@/lib/welcome/templates'

interface TemplateGalleryProps {
  featureId: string
  onSelect: (prompt: string) => void
}

export function TemplateGallery({ featureId, onSelect }: TemplateGalleryProps) {
  const templates = TEMPLATES_BY_FEATURE[featureId] ?? []
  return (
    <div className="w-full flex flex-col gap-3">
      {/* 引导文字 */}
      <div className="text-xs text-muted-foreground pl-1">
        不知道做什么，试试最佳实践案例
      </div>

      {/* 卡片行：响应式，小屏 2 列，大屏按卡片数自适应（4 列平铺） */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 w-full">
        {templates.map((tpl) => (
          <TemplateCard key={tpl.id} template={tpl} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
