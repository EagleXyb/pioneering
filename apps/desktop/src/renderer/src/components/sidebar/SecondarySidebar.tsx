import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'

export function SecondarySidebar(): JSX.Element {
  const { activeSidebarTab } = useAppStore()

  const renderContent = () => {
    switch (activeSidebarTab) {
      case 'files':
        return (
          <div className="p-4">
            <h3 className="text-sm font-medium mb-3">文件浏览器</h3>
            <p className="text-xs text-muted-foreground">暂无打开的文件</p>
          </div>
        )
      case 'history':
        return (
          <div className="p-4">
            <h3 className="text-sm font-medium mb-3">历史记录</h3>
            <p className="text-xs text-muted-foreground">暂无历史记录</p>
          </div>
        )
      case 'tools':
        return (
          <div className="p-4">
            <h3 className="text-sm font-medium mb-3">工具集</h3>
            <p className="text-xs text-muted-foreground">暂无可用工具</p>
          </div>
        )
      case 'skills':
        return (
          <div className="p-4">
            <h3 className="text-sm font-medium mb-3">Skills</h3>
            <p className="text-xs text-muted-foreground">暂无可用技能</p>
          </div>
        )
      default:
        return (
          <div className="p-4">
            <p className="text-xs text-muted-foreground">选择一个功能</p>
          </div>
        )
    }
  }

  return (
    <div className={cn('h-full bg-card overflow-y-auto', 'border-r border-border')}>
      {renderContent()}
    </div>
  )
}
