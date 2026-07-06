import { Outlet } from 'react-router-dom'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { TitleBar } from './TitleBar'
import { StatusBar } from './StatusBar'
import { ActivityBar } from '@/components/sidebar/ActivityBar'
import { SecondarySidebar } from '@/components/sidebar/SecondarySidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { useAppStore } from '@/stores/useAppStore'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'

export function RootLayout(): JSX.Element {
  const { sidebarVisible, chatPanelVisible, bottomPanelVisible } = useAppStore()

  useKeyboardShortcuts()

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <ActivityBar />

        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {sidebarVisible && (
            <>
              <ResizablePanel defaultSize={18} minSize={12} maxSize={30} collapsible collapsedSize={0}>
                <SecondarySidebar />
              </ResizablePanel>
              <ResizableHandle withHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
            </>
          )}

          <ResizablePanel defaultSize={50} minSize={30}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={75} minSize={40}>
                <Outlet />
              </ResizablePanel>

              {bottomPanelVisible && (
                <>
                  <ResizableHandle withHandle className="h-1 bg-border hover:bg-primary/50 transition-colors" />
                  <ResizablePanel defaultSize={25} minSize={10} maxSize={50} collapsible collapsedSize={0}>
                    <div className="h-full bg-card flex items-center justify-center text-sm text-muted-foreground">
                      底部面板 (Terminal / Output / Agent Logs)
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {chatPanelVisible && (
            <>
              <ResizableHandle withHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
              <ResizablePanel defaultSize={32} minSize={20} maxSize={50} collapsible collapsedSize={0}>
                <ChatPanel />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <StatusBar />
    </div>
  )
}
