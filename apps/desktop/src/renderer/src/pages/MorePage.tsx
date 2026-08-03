// ============================================================
// MorePage — 更多功能页
// ============================================================
// 独立组件（非通用占位组件），后续在此页内迭代更多/知识库等功能。
// 当前状态：开发中，即将上线。
// ============================================================

import { Ellipsis } from 'lucide-react'

export function MorePage() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 select-none bg-background">
      <Ellipsis className="size-10 text-muted-foreground/30" strokeWidth={1.5} />
      <p className="text-sm font-medium text-foreground/80">更多</p>
      <p className="text-[11px] text-muted-foreground/50">开发中，即将上线</p>
    </div>
  )
}
