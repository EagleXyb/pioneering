// ============================================================
// Sidebar — 左栏（会话历史 + 文件树 + 工具导航）
// ============================================================

import { useAtom } from 'jotai'
import { sidebarTabAtom, settingsOpenAtom } from '@/stores/atoms'
import {
  MessageSquare,
  FolderOpen,
  History,
  Wrench,
  Bot,
  Settings,
  PanelLeftClose
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { ConversationList } from './ConversationList'
import { FileTree } from './FileTree'

const tabs = [
  { id: 'conversations', label: '对话', icon: MessageSquare },
  { id: 'files', label: '文件', icon: FolderOpen },
  { id: 'history', label: '历史', icon: History },
  { id: 'tools', label: '工具', icon: Wrench },
  { id: 'skills', label: 'Skills', icon: Bot }
] as const

export function Sidebar() {
  const [activeTab, setActiveTab] = useAtom(sidebarTabAtom)
  const [, setSettingsOpen] = useAtom(settingsOpenAtom)

  const renderContent = () => {
    switch (activeTab) {
      case 'conversations':
        return <ConversationList />
      case 'files':
        return <FileTree />
      case 'history':
        return (
          <div className="flex flex-col h-full">
            <div className="px-2 py-2 border-b border-border shrink-0">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                历史记录
              </h3>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-muted-foreground/60">暂无历史记录</p>
            </div>
          </div>
        )
      case 'tools':
        return (
          <div className="flex flex-col h-full">
            <div className="px-2 py-2 border-b border-border shrink-0">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                工具集
              </h3>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-muted-foreground/60">暂无可用工具</p>
            </div>
          </div>
        )
      case 'skills':
        return (
          <div className="flex flex-col h-full">
            <div className="px-2 py-2 border-b border-border shrink-0">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Skills
              </h3>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-muted-foreground/60">暂无可用技能</p>
            </div>
          </div>
        )
      default:
        return <ConversationList />
    }
  }

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-border">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border shrink-0 px-1 py-0.5">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative flex items-center justify-center h-8 flex-1 rounded-md transition-colors',
                activeTab === tab.id
                  ? 'text-foreground bg-accent'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
              title={tab.label}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">{renderContent()}</div>

      {/* Bottom */}
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-border shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7"
          title="设置"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[10px] text-muted-foreground/40">v0.1.0</span>
      </div>
    </div>
  )
}
