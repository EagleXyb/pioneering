import { GitBranch, Wifi, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import { useAgentStore } from '@/stores/useAgentStore'

const modeLabels = { work: 'Work', code: 'Code', design: 'Design' } as const
const modeColors = { work: 'bg-blue-500', code: 'bg-green-500', design: 'bg-purple-500' } as const

export function StatusBar() {
  const { activeMode } = useAppStore()
  const { status } = useAgentStore()

  return (
    <footer className="flex items-center h-6 px-2 bg-primary text-primary-foreground text-[11px] shrink-0 select-none">
      <div className="flex items-center gap-3 flex-1">
        <span className="flex items-center gap-1">
          <span className={cn('w-2 h-2 rounded-full', modeColors[activeMode])} />
          {modeLabels[activeMode]}
        </span>
        <span className="flex items-center gap-1">
          <GitBranch className="size-3" />
          main
        </span>
        {status === 'running' && (
          <span className="flex items-center gap-1 animate-pulse">
            <span className="size-2 rounded-full bg-green-300 animate-ping" />
            Agent 执行中
          </span>
        )}
        {status === 'error' && (
          <span className="flex items-center gap-1 text-yellow-300">
            <span className="size-2 rounded-full bg-yellow-300" />
            Agent 错误
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 flex-1 justify-end">
        <span className="flex items-center gap-1">
          <Zap className="size-3" />
          AI Ready
        </span>
        <span className="flex items-center gap-1">
          <Wifi className="size-3" />
          已连接
        </span>
      </div>
    </footer>
  )
}
