// ============================================================
// WelcomeHeader — 欢迎页标题区
// ============================================================

import { BookOpen } from 'lucide-react'

export function WelcomeHeader() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2.5">
        <BookOpen className="size-7 text-muted-foreground" strokeWidth={1.5} />
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-center">
          Work with Pioneering AI
        </h1>
      </div>
      <p className="text-sm text-muted-foreground text-center max-w-md">
        帮你整理论文综述、生成文档、分析数据、深度研究
      </p>
    </div>
  )
}
