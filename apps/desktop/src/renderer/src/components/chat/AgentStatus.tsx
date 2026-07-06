import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { AgentStep } from '@/types/agent'

interface AgentStatusProps {
  steps: AgentStep[]
  currentStepIndex: number
  isStreaming: boolean
  error: string | null
  onClearError: () => void
}

export function AgentStatus({
  steps,
  currentStepIndex,
  isStreaming,
  error,
  onClearError
}: AgentStatusProps): JSX.Element | null {
  if (!isStreaming && !error) return null

  return (
    <div className="px-4 py-2 border-b border-border shrink-0">
      <div className="max-w-full mx-auto flex items-center gap-2 text-sm">
        {isStreaming && (
          <div className="flex items-center gap-2 text-primary">
            <span className="relative flex size-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full size-2 bg-primary" />
            </span>
            <span className="font-medium">Agent 正在执行...</span>
            {steps.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {currentStepIndex + 1}/{steps.length} 步
              </span>
            )}
          </div>
        )}

        {/* Step progress */}
        {steps.length > 0 && (
          <div className="flex items-center gap-1 ml-2">
            {steps.map((step, i) => (
              <span
                key={step.id}
                className={cn(
                  'size-1.5 rounded-full transition-all',
                  i < currentStepIndex && 'bg-green-500',
                  i === currentStepIndex && 'bg-primary animate-pulse',
                  i > currentStepIndex && 'bg-muted-foreground/30'
                )}
              />
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
