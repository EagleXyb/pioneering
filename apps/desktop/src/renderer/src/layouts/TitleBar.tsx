import { Link } from 'react-router-dom'
import { PanelLeftClose, PanelRightClose, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore, type WorkMode } from '@/stores/useAppStore'
import { useAtom } from 'jotai'
import { sidebarVisibleAtom, contextPanelVisibleAtom } from '@/stores/atoms'
import { usePlatform } from '@/hooks/usePlatform'

const modes: { id: WorkMode; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'code', label: 'Code' },
  { id: 'design', label: 'Design' }
]

export function TitleBar() {
  const { activeMode, setActiveMode } = useAppStore()
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)
  const { isMac } = usePlatform()

  return (
    <header className="flex items-center h-10 border-b border-border bg-background/95 backdrop-blur select-none drag-region shrink-0">
      {/* Mac: left spacing for traffic lights */}
      {isMac && <div className="w-[70px] shrink-0" />}

      {/* Left: sidebar toggle */}
      <div className="flex items-center gap-1 px-2 no-drag">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setSidebarVisible(!sidebarVisible)}
          title="Toggle Sidebar"
        >
          <PanelLeftClose className="size-4" />
        </Button>
      </div>

      {/* Center: mode switching */}
      <div className="flex-1 flex items-center justify-center no-drag">
        <div className="bg-muted rounded-lg p-0.5 flex items-center">
          {modes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setActiveMode(mode.id)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                activeMode === mode.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right: context panel toggle + settings */}
      <div className="flex items-center gap-1 px-2 no-drag">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setContextPanelVisible(!contextPanelVisible)}
          title="Toggle Context Panel"
        >
          <PanelRightClose className="size-4" />
        </Button>
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Settings">
            <Settings className="size-4" />
          </Button>
        </Link>
      </div>
    </header>
  )
}
