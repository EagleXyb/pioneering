// ============================================================
// TaskMonitor — 右栏「任务监控」面板
//
// 严格对照截图样式：
//   - 浅灰背景 #f5f5f5
//   - 分组行高较大（py-4），14px 粗体标题 + ChevronRight
//   - 待办列表：绿色实心圆圈（约 22px）+ 删除线灰色文字
//   - 每个分组（含待办展开后）底部有浅灰色全宽分割线
//   - 最后一个分组（意识更新）无下分割线
//   - 产物右侧：文件夹图标在最右边缘
// ============================================================

import { useState } from 'react'
import { Check, ChevronRight, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TodoItem {
  id: string
  text: string
  completed: boolean
}

interface TaskMonitorProps {
  todoItems?: TodoItem[]
}

// 示例待办数据（可后续接入真实数据源）
const DEFAULT_TODO_ITEMS: TodoItem[] = [
  { id: '1', text: '实证沙箱绕过 + guardrails 参数错配 + 嵌入降级：均已确认', completed: true },
  { id: '2', text: '组合模式路由断链实证确认；PoC 已清理', completed: true },
  { id: '3', text: '收尾扫描完成：感知未注册/OTel接入/MCP闭环/进化消费链均已核实', completed: true },
  { id: '4', text: '汇总完成度分析，按 P0-P4 给出完善方案与结论报告', completed: true }
]

interface SectionRowProps {
  title: string
  icon?: React.ReactNode
  children?: React.ReactNode
  defaultExpanded?: boolean
  isLast?: boolean
}

function SectionRow({ title, icon, children, defaultExpanded = false, isLast = false }: SectionRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className={cn(!isLast && 'border-b border-border/40')}>
      <button
        className="w-full flex items-center justify-between py-4 px-4 text-left hover:bg-black/[0.015] dark:hover:bg-white/[0.015] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-muted-foreground">{title}</span>
          <ChevronRight
            size={16}
            className={cn(
              'text-muted-foreground/70 transition-transform duration-200 mt-[1px]',
              expanded && 'rotate-90'
            )}
          />
        </div>
        {icon && <span className="text-muted-foreground/50">{icon}</span>}
      </button>
      {expanded && children && (
        <div className="px-4 pb-5">
          {children}
        </div>
      )}
    </div>
  )
}

export function TaskMonitor({ todoItems = DEFAULT_TODO_ITEMS }: TaskMonitorProps) {
  return (
    <div className="flex flex-col h-full bg-[#f5f5f5] dark:bg-[#1a1a1a] overflow-y-auto">
      {/* 待办：默认展开 */}
      <SectionRow title="待办" defaultExpanded>
        <div className="space-y-3">
          {todoItems.map((item) => (
            <div key={item.id} className="text-[14px] leading-[1.6]">
              <span
                className={cn(
                  'inline-flex items-center justify-center w-3.5 h-3.5 rounded-full mr-2 -mt-[1px] align-middle shrink-0',
                  item.completed
                    ? 'bg-[#22c55e] text-white'
                    : 'border-2 border-border bg-background'
                )}
              >
                {item.completed && <Check size={9} strokeWidth={3} />}
              </span>
              <span
                className={cn(
                  item.completed
                    ? 'text-muted-foreground/70 line-through'
                    : 'text-muted-foreground'
                )}
              >
                {item.text}
              </span>
            </div>
          ))}
        </div>
      </SectionRow>

      <SectionRow title="产物" icon={<Folder size={20} />} />
      <SectionRow title="技能与 MCP" />
      <SectionRow title="记忆更新" isLast />
    </div>
  )
}
