// ============================================================
// SlashCommandPopover — 「/」命令弹出层（对应文档 §10.1）
// 由 InputArea 以受控方式驱动（open / query / activeIndex），
// 键盘导航在 InputArea 统一处理，本组件只负责渲染与回调。
// ============================================================

import { Eraser, FilePlus2, Terminal, HelpCircle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SlashCommand {
  name: string
  description: string
  icon: typeof Terminal
}

export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: '/clear', description: '清空当前对话', icon: Eraser },
  { name: '/plan', description: '进入计划模式', icon: FilePlus2 },
  { name: '/agent', description: '切换 Agent 模式', icon: Terminal },
  { name: '/help', description: '查看使用帮助', icon: HelpCircle },
  { name: '/optimize', description: '优化当前提示词', icon: Sparkles }
]

/** 评分算法（对应文档 §10.1）：完全匹配 < 前缀 < 包含 < 模糊 < 不匹配 */
export function scoreSlashCommand(name: string, query: string): number {
  const q = query.toLowerCase()
  const n = name.toLowerCase()
  if (!q) return 1
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  const idx = n.indexOf(q)
  if (idx >= 0) return 10 + idx
  // 模糊匹配：字符顺序出现
  let qi = 0
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] === q[qi]) qi++
  }
  if (qi === q.length) return 100 + (n.length - q.length)
  return Infinity
}

export interface SlashCommandPopoverProps {
  open: boolean
  /** 已由 InputArea 过滤并排序后的命令列表 */
  commands: SlashCommand[]
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (command: SlashCommand) => void
}

export function SlashCommandPopover({
  open,
  commands,
  activeIndex,
  onHover,
  onSelect
}: SlashCommandPopoverProps) {
  if (!open || commands.length === 0) return null

  return (
    <div className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg">
      <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">命令</div>
      {commands.map((cmd, i) => {
        const Icon = cmd.icon
        return (
          <button
            key={cmd.name}
            type="button"
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(cmd)
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
              i === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
            )}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">{cmd.name}</span>
            <span className="ml-auto truncate text-[11px] text-muted-foreground">
              {cmd.description}
            </span>
          </button>
        )
      })}
    </div>
  )
}
