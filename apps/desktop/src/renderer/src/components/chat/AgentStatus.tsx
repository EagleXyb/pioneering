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

export function AgentStatus({
  isStreaming,
  thinking,
  toolCalls,
  error,
  onClearError
}: AgentStatusProps) {
  if (!isStreaming && !error) return null

  const doneCount = toolCalls?.filter((t) => t.status === 'completed' || t.status === 'error').length ?? 0

  return (
    <div className="px-4 py-2 border-b border-border shrink-0">
      <div className="max-w-full mx-auto flex items-center gap-2 text-sm">
        {isStreaming && (
          <div className="flex items-center gap-2 text-primary">
            <span className="relative flex size-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full size-2 bg-primary" />
            </span>
            <span className="font-medium">
              {thinking ? 'Agent 正在思考…' : toolCalls && toolCalls.length > 0 ? 'Agent 正在执行…' : 'Agent 正在执行…'}
            </span>
            {toolCalls && toolCalls.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {doneCount}/{toolCalls.length} 步
              </span>
            )}
          </div>
        )}

        {/* 实时工具调用轨迹 */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="flex items-center gap-1.5 ml-1 overflow-x-auto scrollbar-none">
            {toolCalls.map((tc) => (
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
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-500">
            <span>⚠ {error}</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClearError}>
              关闭
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
