import { useState } from 'react'
import { FolderSymlink, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@shared/types'

interface ToolCallCardProps {
  toolCall: ToolCall
}

// 工具名 → 人类可读的中文说明（原始英文名以 title 形式展示，鼠标悬停可查）
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  doc_writer: '文档生成',
  search_engine: '联网搜索',
  datetime: '日期时间',
  calculator: '计算器',
}

function getToolDisplayName(name: string): string {
  return TOOL_DISPLAY_NAMES[name] ?? name
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = {
    pending: <Loader2 className="size-2.5 text-muted-foreground animate-spin" />,
    running: <Loader2 className="size-2.5 text-primary animate-spin" />,
    completed: <CheckCircle2 className="size-2.5 text-green-500" />,
    error: <XCircle className="size-2.5 text-red-500" />
  }

  const hasArgs = toolCall.arguments && Object.keys(toolCall.arguments).length > 0
  const isLongResult = !!toolCall.result && toolCall.result.length > 80

  return (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-2 rounded-lg border text-xs',
        toolCall.status === 'completed' && 'border-green-500/20 bg-green-500/5',
        toolCall.status === 'error' && 'border-red-500/20 bg-red-500/5',
        toolCall.status === 'running' && 'border-primary/20 bg-primary/5',
        toolCall.status === 'pending' && 'border-border bg-muted/20'
      )}
    >
      <span className="mt-0.5 shrink-0">{statusIcon[toolCall.status]}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <FolderSymlink className="size-2 text-muted-foreground shrink-0" />
          <span
            className="font-medium text-foreground break-words"
            title={getToolDisplayName(toolCall.name) === toolCall.name ? undefined : toolCall.name}
          >
            {getToolDisplayName(toolCall.name)}
          </span>
        </div>

        {/* P3: 工具调用参数（来自 TOOL_CALL_ARGS 事件，流式补全后此处展示） */}
        {hasArgs && (
          <pre className="mt-1 text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap break-words">
            {JSON.stringify(toolCall.arguments, null, 1)}
          </pre>
        )}

        {/* P6: 工具结果支持展开/收起，避免长输出被截断不可读 */}
        {toolCall.result && (
          <div className="mt-1">
            <p
              className={cn(
                'text-[10px] text-muted-foreground break-words whitespace-pre-wrap',
                !expanded && 'line-clamp-2'
              )}
            >
              {toolCall.result}
            </p>
            {isLongResult && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-0.5 text-[10px] text-primary hover:underline"
              >
                {expanded ? '收起' : '展开'}
              </button>
            )}
          </div>
        )}

        {/* P4: 工具级错误信息独立呈现，便于在消息流内定位是哪一步出错 */}
        {toolCall.status === 'error' && toolCall.errorMessage && (
          <p className="mt-1 text-[10px] text-red-500 break-words whitespace-pre-wrap">
            {toolCall.errorMessage}
          </p>
        )}
      </div>
    </div>
  )
}
