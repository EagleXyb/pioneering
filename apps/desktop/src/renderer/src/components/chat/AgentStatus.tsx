import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, Wrench } from 'lucide-react'
import type { ToolCall } from '@shared/types'

interface AgentStatusProps {
  isStreaming: boolean
  thinking?: string
  toolCalls?: ToolCall[]
  error: string | null
  onClearError: () => void
}

const MAX_VISIBLE_TOOLS = 6

export function AgentStatus({
  isStreaming,
  thinking,
  toolCalls,
  error,
  onClearError
}: AgentStatusProps) {
  if (!isStreaming && !error) return null

  // P9: 精确状态——优先显示当前正在运行的工具，其次思考中，最后执行中
  const runningTool = toolCalls?.find((t) => t.status === 'running')
  const label = runningTool
    ? `Agent 正在调用 ${runningTool.name}…`
    : thinking
      ? 'Agent 正在思考…'
      : 'Agent 正在执行…'
  const doneCount = toolCalls?.filter((t) => t.status === 'completed' || t.status === 'error').length ?? 0
  const visibleTools = toolCalls?.slice(0, MAX_VISIBLE_TOOLS) ?? []
  const overflowCount = (toolCalls?.length ?? 0) - visibleTools.length

  return (
    <div className="px-4 py-2 border-b border-border shrink-0 space-y-1.5">
      {/* 第一行：运行状态 + 工具步数 */}
      <div className="max-w-full mx-auto flex items-center gap-2 text-sm">
        {isStreaming && (
          <div className="flex items-center gap-2 text-primary">
            <span className="relative flex size-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full size-2 bg-primary" />
            </span>
            <span className="font-medium">{label}</span>
            {toolCalls && toolCalls.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {doneCount}/{toolCalls.length} 步
              </span>
            )}
          </div>
        )}
      </div>

      {/* 第二行：实时工具调用轨迹（横向滚动，超出部分用 +N 折叠，避免隐藏） */}
      {toolCalls && toolCalls.length > 0 && (
        <div className="flex items-center gap-1.5 max-w-full overflow-x-auto scrollbar-none">
          {visibleTools.map((tc) => (
            <span
              key={tc.id}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border shrink-0',
                tc.status === 'completed' && 'border-green-500/30 bg-green-500/10 text-green-600',
                tc.status === 'error' && 'border-red-500/30 bg-red-500/10 text-red-600',
                tc.status === 'running' && 'border-primary/30 bg-primary/10 text-primary',
                (tc.status === 'pending' || !tc.status) && 'border-border bg-muted/30 text-muted-foreground'
              )}
            >
              {tc.status === 'completed' ? (
                <CheckCircle2 className="size-3" />
              ) : tc.status === 'running' ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Wrench className="size-3" />
              )}
              {tc.name}
            </span>
          ))}
          {overflowCount > 0 && (
            <span className="flex items-center px-1.5 py-0.5 rounded-full text-[10px] border border-border bg-muted/30 text-muted-foreground shrink-0">
              +{overflowCount}
            </span>
          )}
        </div>
      )}

      {/* 错误提示独占一行，避免与工具轨迹互相挤压 */}
      {error && (
        <div className="flex items-center gap-2 text-red-500 text-sm">
          <span>⚠ {error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClearError}>
            关闭
          </Button>
        </div>
      )}
    </div>
  )
}
