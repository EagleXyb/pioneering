import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, Wrench } from 'lucide-react'
import type { ToolCall } from '@shared/types'

interface AgentStatusProps {
  toolCalls?: ToolCall[]
  error: string | null
  onClearError: () => void
}

const MAX_VISIBLE_TOOLS = 6

export function AgentStatus({ toolCalls, error, onClearError }: AgentStatusProps) {
  // 运行态（思考 / 工具轨迹）已内联于流式助手消息气泡，此处仅在出错时展示错误条，
  // 不再作为顶部横条条件渲染，避免 layout shift，且不复制消息流内已呈现的信息。
  if (!error) return null

  const visibleTools = toolCalls?.slice(0, MAX_VISIBLE_TOOLS) ?? []
  const overflowCount = (toolCalls?.length ?? 0) - visibleTools.length

  return (
    <div className="px-4 py-2 border-t border-border shrink-0 space-y-1.5">
      {/* 工具调用轨迹（出错时展示已完成 / 出错步骤，便于排查） */}

      {/* 实时工具调用轨迹（横向滚动，超出部分用 +N 折叠，避免隐藏） */}
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

      {/* 错误提示 */}
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
