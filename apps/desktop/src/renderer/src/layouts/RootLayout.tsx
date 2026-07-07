// ============================================================
// RootLayout — 自适应根布局
//   三栏模式 (>= 断点)：左 Sidebar + 中内容 + 右 ContextPanel，
//                      使用 ResizablePanelGroup（始终渲染 3 个 Panel，
//                      通过 collapse/expand 控显隐，避免拖拽 Bug）。
//   覆盖模式 (< 断点)：中栏全宽，Sidebar / ContextPanel 转 Drawer 抽屉。
// 断点与窗口记忆按平台区分，保证各 OS 下的一致体验。
// ============================================================

import { Outlet } from 'react-router-dom'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@/components/ui/resizable'
import { TitleBar } from './TitleBar'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ContextPanel } from '@/components/context-panel/ContextPanel'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { Drawer } from '@/components/layout/Drawer'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAtom } from 'jotai'
import { sidebarVisibleAtom, contextPanelVisibleAtom } from '@/stores/atoms'
import { usePlatform } from '@/hooks/usePlatform'
import { usePanelToggle } from '@/platform/usePanelToggle'

// 三栏初始比例（sidebar + center + context-panel = 100）
const SIDEBAR_INIT = 15
const CENTER_INIT = 55
const CONTEXT_INIT = 30

export function RootLayout() {
  const { platform } = usePlatform()
  const { sidebarRef, contextRef, toggleSidebar, toggleContext, mode } = usePanelToggle()
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)

  useKeyboardShortcuts()

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <TitleBar onToggleSidebar={toggleSidebar} onToggleContext={toggleContext} />

      {mode === 'three-column' ? (
        <ResizablePanelGroup
          // 按平台区分 autoSaveId，各 OS 记忆各自布局
          autoSaveId={`pioneering-main-layout-${platform}`}
          direction="horizontal"
          className="flex-1"
        >
          {/* 左栏：Sidebar */}
          <ResizablePanel
            id="sidebar"
            ref={sidebarRef}
            defaultSize={SIDEBAR_INIT}
            minSize={10}
            maxSize={25}
            collapsible
            collapsedSize={0}
          >
            <Sidebar />
          </ResizablePanel>

          <ResizableHandle className="w-px bg-border hover:bg-primary/50 transition-colors" />

          {/* 中栏：页面内容 */}
          <ResizablePanel id="center" defaultSize={CENTER_INIT} minSize={30}>
            <Outlet />
          </ResizablePanel>

          <ResizableHandle className="w-px bg-border hover:bg-primary/50 transition-colors" />

          {/* 右栏：Context Panel */}
          <ResizablePanel
            id="context-panel"
            ref={contextRef}
            defaultSize={CONTEXT_INIT}
            minSize={15}
            maxSize={50}
            collapsible
            collapsedSize={0}
          >
            <ContextPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        // 覆盖模式：中栏全宽，侧栏/上下文转抽屉
        <div className="flex-1 relative overflow-hidden">
          <Outlet />
          <Drawer open={sidebarVisible} side="left" onClose={() => setSidebarVisible(false)}>
            <Sidebar />
          </Drawer>
          <Drawer open={contextPanelVisible} side="right" onClose={() => setContextPanelVisible(false)}>
            <ContextPanel />
          </Drawer>
        </div>
      )}

      {/* 全局设置弹框（两栏布局，与路由解耦） */}
      <SettingsDialog />
    </div>
  )
}
