// ============================================================
// RootLayout — 三栏 Resizable 根布局（Cursor 风格）
//   左栏: Sidebar (会话历史 + 文件树)
//   中栏: Chat Area / 页面内容 (通过 Outlet)
//   右栏: Context Panel (Code / Diff / Terminal)
// ============================================================

import { Outlet } from 'react-router-dom'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { TitleBar } from './TitleBar'
import { StatusBar } from './StatusBar'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ContextPanel } from '@/components/context-panel/ContextPanel'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAtom } from 'jotai'
import { sidebarVisibleAtom, contextPanelVisibleAtom, sidebarWidthAtom, contextPanelWidthAtom } from '@/stores/atoms'

export function RootLayout() {
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom)
  const [contextWidth, setContextWidth] = useAtom(contextPanelWidthAtom)

  useKeyboardShortcuts()

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <TitleBar />

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* 左栏：Sidebar */}
        {sidebarVisible && (
          <>
            <ResizablePanel
              defaultSize={sidebarWidth}
              minSize={10}
              maxSize={25}
              collapsible
              collapsedSize={0}
              onResize={(size) => setSidebarWidth(size)}
            >
              <Sidebar />
            </ResizablePanel>
            <ResizableHandle
              withHandle
              className="w-px bg-border hover:bg-primary/50 transition-colors"
            />
          </>
        )}

        {/* 中栏：页面内容 */}
        <ResizablePanel defaultSize={100 - sidebarWidth - (contextPanelVisible ? contextWidth : 0)} minSize={30}>
          <Outlet />
        </ResizablePanel>

        {/* 右栏：Context Panel */}
        {contextPanelVisible && (
          <>
            <ResizableHandle
              withHandle
              className="w-px bg-border hover:bg-primary/50 transition-colors"
            />
            <ResizablePanel
              defaultSize={contextWidth}
              minSize={15}
              maxSize={50}
              collapsible
              collapsedSize={0}
              onResize={(size) => setContextWidth(size)}
            >
              <ContextPanel />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <StatusBar />
    </div>
  )
}

