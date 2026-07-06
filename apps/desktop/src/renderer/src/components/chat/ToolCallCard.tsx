import { Wrench, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@shared/types'

interface ToolCallCardProps {
  toolCall: ToolCall
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const statusIcon = {
    pending: <Loader2 className="size-3.5 text-muted-foreground animate-spin" />,
    running: <Loader2 className="size-3.5 text-primary animate-spin" />,
    completed: <CheckCircle2 className="size-3.5 text-green-500" />,
    error: <XCircle className="size-3.5 text-red-500" />
  }

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
          <Wrench className="size-3 text-muted-foreground shrink-0" />
          <span className="font-medium text-foreground">{toolCall.name}</span>
        </div>
        {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
          <pre className="mt-1 text-[10px] text-muted-foreground overflow-x-auto">
            {JSON.stringify(toolCall.arguments, null, 1)}
          </pre>
        )}
        {toolCall.result && (
          <p className="mt-1 text-muted-foreground line-clamp-2">{toolCall.result}</p>
        )}
      </div>
    </div>
  )
}
