import { useState } from 'react'
import { GraduationCap, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

type TabKey = 'plugins' | 'skills'

export function PluginsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('plugins')

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tab 头部 */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-10">
          <button
            onClick={() => setActiveTab('plugins')}
            className={cn(
              'relative pb-2 text-[18px] font-bold transition-colors',
              activeTab === 'plugins'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/70'
            )}
          >
            插件
            {activeTab === 'plugins' && (
              <div className="absolute bottom-0 left-0 right-0 h-[4px] bg-foreground rounded-full" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={cn(
              'relative pb-2 text-[18px] font-bold transition-colors',
              activeTab === 'skills'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/70'
            )}
          >
            技能
            {activeTab === 'skills' && (
              <div className="absolute bottom-0 left-0 right-0 h-[4px] bg-foreground rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 flex flex-col items-center justify-center gap-2 select-none">
        {activeTab === 'plugins' ? (
          <>
            <GraduationCap className="size-10 text-muted-foreground/30" strokeWidth={1.5} />
            <p className="text-sm font-medium text-foreground/80">插件</p>
            <p className="text-[11px] text-muted-foreground/50">开发中，即将上线</p>
          </>
        ) : (
          <>
            <FolderOpen className="size-10 text-muted-foreground/30" strokeWidth={1.5} />
            <p className="text-sm font-medium text-foreground/80">技能</p>
            <p className="text-[11px] text-muted-foreground/50">开发中，即将上线</p>
          </>
        )}
      </div>
    </div>
  )
}
