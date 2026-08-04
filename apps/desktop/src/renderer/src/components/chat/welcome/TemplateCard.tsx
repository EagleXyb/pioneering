// ============================================================
// TemplateCard — 单个模板卡片（图片缩略图样式）
// ============================================================
// 视觉对齐 TRAE 参考图：
//   - 大圆角（圆角 ~14px）+ 柔和阴影
//   - 上方大尺寸缩略图区域（背景渐变 + 模拟文档图案）
//   - 下方标题文字（居中）
//   - hover：轻微放大 + 阴影增强
// ============================================================

import { cn } from '@/lib/utils'
import type { TemplateItem } from '@/lib/welcome/templates'

interface TemplateCardProps {
  template: TemplateItem
  onSelect: (prompt: string) => void
}

export function TemplateCard({ template, onSelect }: TemplateCardProps) {
  return (
    <button
      onClick={() => onSelect(template.prompt)}
      className="group flex flex-col gap-2 text-left w-full transition-transform duration-200 ease-out hover:scale-[1.02]"
    >
      {/* 缩略图区域：大圆角 + 渐变背景 + 模拟文档图案 */}
      <div
        className={cn(
          'relative w-full aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br',
          template.gradient,
          'shadow-sm ring-1 ring-black/5 dark:ring-white/5',
          'transition-all duration-200 group-hover:shadow-md'
        )}
      >
        {/* 模拟文档图案：半透明白色文档卡片 + 文字线条 + 标签 */}
        <div className="absolute inset-3 flex items-center justify-center">
          <div className="relative w-[82%] h-[78%] rounded-lg bg-white/90 shadow-[0_2px_12px_rgba(0,0,0,0.08)] overflow-hidden">
            {/* 文档顶部标题块 */}
            {template.preview && (
              <>
                <div className="absolute top-2 left-2 right-2 h-2 bg-black/80 rounded-sm" />
                <div className="absolute top-5 left-2 w-2/3 h-1.5 bg-black/30 rounded-sm" />
                <div className="absolute top-8 left-2 w-1/2 h-1.5 bg-black/15 rounded-sm" />
                {/* 标签 chips */}
                <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
                  {template.preview.tags.map((tag, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 rounded-md bg-black/10 text-[8px] text-black/70 font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {/* 装饰条 */}
                <div className="absolute top-2 right-2 bottom-2 w-1 rounded-full"
                  style={{
                    background: `linear-gradient(to bottom,
                      rgba(0,0,0,0.15) 0%,
                      rgba(0,0,0,0.08) 50%,
                      rgba(0,0,0,0.02) 100%)`
                  }}
                />
                {/* 色块装饰（品牌/活动/求职等主题色条） */}
                <div className="absolute top-2 left-2 w-1 h-4 rounded-sm opacity-70"
                  style={{
                    background: `linear-gradient(to bottom,
                      hsl(${template.id.charCodeAt(0) * 7 % 360}, 70%, 55%),
                      hsl(${template.id.charCodeAt(1) * 11 % 360}, 70%, 65%))`
                  }}
                />
              </>
            )}
          </div>
        </div>

        {/* 装饰点阵（右上角区域） */}
        <div className="absolute top-1.5 right-2 opacity-20 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(0,0,0,0.6) 0.5px, transparent 0.5px)',
            backgroundSize: '3px 3px',
            width: '48px',
            height: '36px'
          }}
        />
        {/* 装饰点阵（右下角区域） */}
        <div className="absolute bottom-1.5 right-1.5 opacity-15 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(0,0,0,0.6) 0.5px, transparent 0.5px)',
            backgroundSize: '3.5px 3.5px',
            width: '60px',
            height: '44px'
          }}
        />
      </div>

      {/* 标题文字 */}
      <span className="text-sm font-medium text-foreground text-center">
        {template.title}
      </span>
    </button>
  )
}
