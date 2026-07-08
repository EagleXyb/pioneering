// ============================================================
// SkillsMenu — 「+」技能/命令菜单（对应文档 §8）
// 负责文件附加、模式切换、快捷命令插入。数据源来自项目本地能力，
// 通过回调与 InputArea 通信，保持组件独立可复用。
// ============================================================

import { useState } from 'react'
import { Paperclip, Zap, Terminal, Eraser, HelpCircle, Plus, FilePlus2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface SkillsMenuProps {
  onAttachFile: () => void
  onToggleAgent: () => void
  onInsertCommand: (command: string) => void
  agentMode: boolean
  disabled?: boolean
}

export function SkillsMenu({
  onAttachFile,
  onToggleAgent,
  onInsertCommand,
  agentMode,
  disabled
}: SkillsMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-muted-foreground disabled:opacity-30"
          title="更多功能"
        >
          <Plus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel>附件与模式</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onAttachFile()}>
          <Paperclip className="size-4" />
          附加文件
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onToggleAgent()}>
          <Zap className={cn('size-4', agentMode && 'text-primary')} />
          Agent 模式
          <span className="ml-auto text-[10px] text-muted-foreground">
            {agentMode ? '已开启' : '已关闭'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>快捷命令</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onInsertCommand('/clear')}>
          <Eraser className="size-4" />
          清空对话
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onInsertCommand('/plan')}>
          <FilePlus2 className="size-4" />
          计划模式
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onInsertCommand('/agent')}>
          <Terminal className="size-4" />
          切换 Agent
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onInsertCommand('/help')}>
          <HelpCircle className="size-4" />
          帮助
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
