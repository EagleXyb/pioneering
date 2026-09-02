// ============================================================
// TemplateGallery — 模板卡片画廊（对齐参考图）
// ============================================================
// 布局对齐 TRAE 参考图：
//   - 顶部一行：
//       左：「不知道做什么，试试最佳实践案例」
//       右：↻ 换一批按钮 + × 关闭按钮
//   - 卡片网格：固定 4 列（grid-cols-4），等宽平铺
//   - 「换一批」：从模板池中轮换出不同的 4 张展示
//   - 「关闭」：隐藏整个画廊（不卸载，只做 visibility）
// ============================================================

import { useMemo, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { TemplateCard } from './TemplateCard'
import { TEMPLATES_BY_FEATURE, type TemplateItem } from '@/lib/welcome/templates'

interface TemplateGalleryProps {
  featureId: string
  onSelect?: (prompt: string) => void
}

const PAGE_SIZE = 4

/** 稳定的伪随机洗牌（基于 seed） */
function shuffleBySeed<T>(arr: T[], seed: number): T[] {
  const a = arr.slice()
  let s = seed >>> 0
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function TemplateGallery({ featureId, onSelect }: TemplateGalleryProps) {
  const [visible, setVisible] = useState(true)
  const [page, setPage] = useState(0)

  const pool: TemplateItem[] = useMemo(
    () => TEMPLATES_BY_FEATURE[featureId] ?? [],
    [featureId]
  )

  // 切换 feature 时重置分页和显隐
  const displayed = useMemo(() => {
    if (pool.length === 0) return []
    const totalPages = Math.max(1, Math.ceil(pool.length / PAGE_SIZE))
    const safePage = page % totalPages
    // 每次「换一批」取不同起点：用 safePage 作为 seed 做洗牌，再按 PAGE_SIZE 切片
    const shuffled = shuffleBySeed(pool, safePage + 1)
    return shuffled.slice(0, PAGE_SIZE)
  }, [pool, page])

  if (!visible) return null

  return (
    <div
      className="w-full flex flex-col gap-3"
      style={{ paddingTop: 30, paddingBottom: 0 }}
    >
      {/* ===== 顶部操作行 ===== */}
      <div className="flex items-center justify-between w-full">
        <span className="text-xs text-muted-foreground">
          不知道做什么，试试最佳实践案例
        </span>

        <div className="flex items-center gap-2">
          {/* 换一批 */}
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            title="换一批"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px]
                       text-xs text-muted-foreground hover:text-foreground
                       hover:bg-accent transition-colors"
          >
            <RefreshCw className="size-3.5" strokeWidth={2} />
            换一批
          </button>

          {/* 关闭 */}
          <button
            type="button"
            onClick={() => setVisible(false)}
            title="收起推荐"
            className="inline-flex items-center justify-center size-6 rounded-[5px]
                       text-muted-foreground hover:text-foreground
                       hover:bg-accent transition-colors"
          >
            <X className="size-3.5" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* ===== 卡片网格：固定 4 列 ===== */}
      <div className="grid grid-cols-4 gap-3 w-full">
        {displayed.map((tpl) => (
          <TemplateCard key={tpl.id + page} template={tpl} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
