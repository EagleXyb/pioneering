// ============================================================
// SkillsMenu — 「+」技能/命令菜单（对应文档 §8）
// 负责文件附加、模式切换、快捷命令插入。数据源来自项目本地能力，
// 通过回调与 InputArea 通信，保持组件独立可复用。
// ============================================================

import { useState } from 'react'
import { Paperclip, Zap, Terminal, Eraser, HelpCircle, LayoutGrid, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
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
        <Button
          type="button"
          disabled={disabled}
          variant="ghost"
          size="icon-sm"
          title="工具"
        >
          <LayoutGrid />
          <ChevronDown className={cn(open && 'rotate-180')} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuItem onSelect={() => onAttachFile()}>
          <Paperclip className="size-4" />
          <span>附件</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onToggleAgent()}>
          <Zap className={cn('size-4', agentMode && 'text-primary')} />
          <span>模式{agentMode ? ' · Agent' : ''}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onInsertCommand('/agent')}>
          <Terminal className="size-4" />
          <span>技能</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAttachFile()}>
          <HelpCircle className="size-4" />
          <span>连接</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>快捷命令</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onInsertCommand('/clear')}>
          <Eraser className="size-4" />
          <span>清空对话</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onInsertCommand('/help')}>
          <HelpCircle className="size-4" />
          <span>帮助</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
