// ============================================================
// RootLayout — 三栏 Resizable 根布局（Cursor 风格）
//   左栏: Sidebar (会话历史 + 文件树)
//   中栏: Chat Area / 页面内容 (通过 Outlet)
//   右栏: Context Panel (Code / Diff / Terminal)
//
// 注意：所有 3 个 Panel 始终渲染、永不条件移除，
// 通过 ImperativePanelHandle 的 collapse()/expand() 控制显隐。
// 条件渲染会导致 ResizablePanelGroup 子元素数量变化→拖拽 Bug。
// ============================================================

import { useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@/components/ui/resizable'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { TitleBar } from './TitleBar'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ContextPanel } from '@/components/context-panel/ContextPanel'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAtom } from 'jotai'
import {
  sidebarVisibleAtom,
  contextPanelVisibleAtom,
  sidebarWidthAtom,
  contextPanelWidthAtom
} from '@/stores/atoms'

// 三栏初始比例（sidebar + center + context-panel = 100）
const SIDEBAR_INIT = 15
const CENTER_INIT = 55
const CONTEXT_INIT = 30

export function RootLayout() {
  const sidebarRef = useRef<ImperativePanelHandle>(null)
  const contextRef = useRef<ImperativePanelHandle>(null)

  const [sidebarVisible] = useAtom(sidebarVisibleAtom)
  const [contextPanelVisible] = useAtom(contextPanelVisibleAtom)
  const [, setSidebarWidth] = useAtom(sidebarWidthAtom)
  const [, setContextWidth] = useAtom(contextPanelWidthAtom)

  useKeyboardShortcuts()

  // 同步侧边栏显隐 → 调用 collapse/expand
  useEffect(() => {
    const p = sidebarRef.current
    if (sidebarVisible) {
      p?.expand()
    } else {
      p?.collapse()
    }
  }, [sidebarVisible])

  // 同步上下文面板显隐 → 调用 collapse/expand
  useEffect(() => {
    const p = contextRef.current
    if (contextPanelVisible) {
      p?.expand()
    } else {
      p?.collapse()
    }
  }, [contextPanelVisible])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <TitleBar
        sidebarRef={sidebarRef}
        contextRef={contextRef}
      />

      <ResizablePanelGroup
        autoSaveId="pioneering-main-layout"
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
          onResize={(size) => size > 0 && setSidebarWidth(size)}
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
          onResize={(size) => size > 0 && setContextWidth(size)}
        >
          <ContextPanel />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* 全局设置弹框（两栏布局，与路由解耦） */}
      <SettingsDialog />
    </div>
  )
}

