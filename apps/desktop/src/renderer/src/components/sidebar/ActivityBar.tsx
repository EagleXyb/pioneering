import { MessageSquare, Bot, Settings, History, Wrench } from 'lucide-react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from '@/components/ui/tooltip'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  shortcut?: string
}

const navItems: NavItem[] = [
  { id: 'files', label: '文件浏览器', icon: <MessageSquare className="size-[18px]" />, shortcut: '⌘1' },
  { id: 'history', label: '历史记录', icon: <History className="size-[18px]" />, shortcut: '⌘2' },
  { id: 'tools', label: '工具集', icon: <Wrench className="size-[18px]" />, shortcut: '⌘3' },
  { id: 'skills', label: 'Skills', icon: <Bot className="size-[18px]" />, shortcut: '⌘4' }
]

const bottomItems: NavItem[] = [
  { id: 'chat', label: 'AI 对话', icon: <MessageSquare className="size-[18px]" />, shortcut: '⌘B' },
  { id: 'settings', label: '设置', icon: <Settings className="size-[18px]" /> }
]

export function ActivityBar(): JSX.Element {
  const { activeSidebarTab, setActiveSidebarTab, toggleSidebar } = useAppStore()

  const handleClick = (id: string) => {
    if (activeSidebarTab === id) {
      toggleSidebar()
    } else {
      setActiveSidebarTab(id as typeof activeSidebarTab)
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <nav className="flex flex-col items-center w-12 bg-sidebar border-r border-border py-2 justify-between shrink-0">
        <div className="flex flex-col items-center gap-1">
          {navItems.map(({ id, icon, label, shortcut }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleClick(id)}
                  className={cn(
                    'relative flex items-center justify-center w-9 h-9 rounded-lg transition-all',
                    'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    activeSidebarTab === id
                      ? 'text-foreground bg-sidebar-accent'
                      : 'text-muted-foreground'
                  )}
                >
                  {activeSidebarTab === id && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r" />
                  )}
                  {icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="flex items-center gap-2">
                <span>{label}</span>
                {shortcut && (
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">
                    {shortcut}
                  </kbd>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="flex flex-col items-center gap-1">
          {bottomItems.map(({ id, icon, label, shortcut }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleClick(id)}
                  className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-lg transition-all',
                    'hover:bg-sidebar-accent text-muted-foreground hover:text-foreground'
                  )}
                >
                  {icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="flex items-center gap-2">
                <span>{label}</span>
                {shortcut && (
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">
                    {shortcut}
                  </kbd>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="mt-2 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center cursor-pointer">
                <span className="text-xs font-medium text-primary">U</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">用户</TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </TooltipProvider>
  )
}
