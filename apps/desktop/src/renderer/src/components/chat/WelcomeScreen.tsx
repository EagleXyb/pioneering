// ============================================================
// WelcomeScreen — 空会话欢迎引导页（WorkBuddy 极简风格）
// ============================================================
// 设计要点：
//   - 大量留白、垂直居中
//   - 大号欢迎标题
//   - 分类 Tab 胶囊（选中态深色填充）
//   - 快捷提示词 pill 标签
//   - 无阴影、无渐变、无多余装饰
// ============================================================

import { useState } from 'react'
import {
  FileText,
  Code2,
  Palette,
  BarChart3,
  Search,
  Video,
  Presentation,
  FolderKanban,
  FileCode,
  Lightbulb
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface WelcomeScreenProps {
  onQuickPrompt?: (text: string) => void
}

// ---- 分类 ----
const categories = [
  { id: 'office', label: '日常办公', icon: FileText },
  { id: 'dev', label: '代码开发', icon: Code2 },
  { id: 'creative', label: '设计创意', icon: Palette }
] as const

type CategoryId = (typeof categories)[number]['id']

// ---- 各分类下的快捷提示词 ----
const promptsByCategory: Record<CategoryId, { icon: React.ComponentType<{ className?: string }>; label: string; prompt: string }[]> = {
  office: [
    { icon: FileText, label: '文档处理', prompt: '帮我润色和整理一份文档，使其更专业流畅' },
    { icon: BarChart3, label: '数据分析', prompt: '我有一组数据，帮我分析并生成可视化建议' },
    { icon: Search, label: '深度研究', prompt: '帮我深度研究一个主题，给出结构化的分析报告' },
    { icon: Presentation, label: '幻灯片', prompt: '帮我规划一份演示文稿的大纲和内容要点' }
  ],
  dev: [
    { icon: FileCode, label: '代码解释', prompt: '解释一下这段代码的工作原理，给出详细注释' },
    { icon: Code2, label: '代码重构', prompt: '帮我重构这段代码，使其更简洁易维护' },
    { icon: FolderKanban, label: '技术方案', prompt: '帮我设计一个技术方案，包括架构选型和实现思路' },
    { icon: Lightbulb, label: 'Bug 排查', prompt: '帮我分析这个 Bug 可能的原因和修复方案' }
  ],
  creative: [
    { icon: Palette, label: '设计建议', prompt: '给我一些 UI 设计建议，配色方案和排版思路' },
    { icon: Video, label: '视频脚本', prompt: '帮我写一个短视频脚本，包含分镜和台词' },
    { icon: Lightbulb, label: '创意写作', prompt: '帮我写一篇有创意的文章或故事' },
    { icon: FileText, label: '文案撰写', prompt: '帮我写一段产品宣传文案，突出核心卖点' }
  ]
}

export function WelcomeScreen({ onQuickPrompt }: WelcomeScreenProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('office')
  const prompts = promptsByCategory[activeCategory]

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12">
      <div className="w-full max-w-[var(--chat-col-max)] flex flex-col items-center gap-8">
        {/* ===== 标题 ===== */}
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-center">
          Pioneering AI，我帮你
        </h1>

        {/* ===== 分类 Tab ===== */}
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-muted">
          {categories.map((cat) => {
            const Icon = cat.icon
            const isActive = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-3.5" />
                {cat.label}
              </button>
            )
          })}
        </div>

        {/* ===== 快捷提示词 pill ===== */}
        <div className="flex flex-wrap justify-center gap-2">
          {prompts.map((item, idx) => {
            const Icon = item.icon
            return (
              <button
                key={idx}
                onClick={() => onQuickPrompt?.(item.prompt)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-border bg-background text-sm text-foreground/80 transition-all hover:border-foreground/20 hover:bg-accent hover:text-foreground"
              >
                <Icon className="size-3.5 text-muted-foreground" />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
