// ============================================================
// RootLayout — 自适应根布局
//   三栏模式 (>= 断点)：左 Sidebar + 中内容 + 右 ContextPanel，
//                      使用 ResizablePanelGroup（始终渲染 3 个 Panel，
//                      通过 collapse/expand 控显隐，避免拖拽 Bug）。
//   覆盖模式 (< 断点)：中栏全宽，Sidebar / ContextPanel 转 Drawer 抽屉。
// 断点与窗口记忆按平台区分，保证各 OS 下的一致体验。
// ============================================================

import { Outlet, useNavigate } from 'react-router-dom'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@/components/ui/resizable'
import { PanelLeftOpen, Plus, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from '@/components/ui/tooltip'
import { TitleBar } from './TitleBar'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ContextPanel } from '@/components/context-panel/ContextPanel'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { Drawer } from '@/components/layout/Drawer'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAtom } from 'jotai'
import { sidebarVisibleAtom, contextPanelVisibleAtom } from '@/stores/atoms'
import type { Platform } from '@shared/types'
import { formatAccelerator } from '@/menu/formatAccelerator'
import { usePlatform } from '@/hooks/usePlatform'
import { usePanelToggle } from '@/platform/usePanelToggle'
import { useChatStore } from '@/stores/chatStore'

// 三栏模式：左侧 Sidebar 固定 260px，中栏 + 右栏用 ResizablePanelGroup 调整比例（合计 100）
const SIDEBAR_WIDTH = 262
const CENTER_INIT = 65
const CONTEXT_INIT = 35

export function RootLayout() {
  const { platform } = usePlatform()
  const { contextRef, mode } = usePanelToggle()
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)
  const navigate = useNavigate()
  const { createSession } = useChatStore()

  const handleCreate = async () => {
    await createSession()
    navigate('/')
  }

  useKeyboardShortcuts(handleCreate)

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <TitleBar />

      {mode === 'three-column' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* 左栏：固定 260px 宽度的 Sidebar，可折叠 */}
          <div
            className="shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
            style={{ width: sidebarVisible ? SIDEBAR_WIDTH : 0 }}
          >
            <Sidebar />
          </div>

          {/* 中栏 + 右栏：可拖拽调整比例（2 个 Panel，比例合计 100） */}
          <ResizablePanelGroup
            // 按平台区分 autoSaveId，各 OS 记忆各自布局
            autoSaveId={`pioneering-main-layout-2p-${platform}`}
            direction="horizontal"
            className="flex-1"
          >
            {/* 中栏：页面内容 */}
            <ResizablePanel id="center" defaultSize={CENTER_INIT} minSize={30}>
              <div className="flex flex-col h-full">
                {!sidebarVisible && (
                  <TopBarActions
                    platform={platform}
                    onExpandSidebar={() => setSidebarVisible(true)}
                    onCreate={handleCreate}
                  />
                )}
                <div className="flex-1 min-h-0">
                  <Outlet />
                </div>
              </div>
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
        </div>
      ) : (
        // 覆盖模式：中栏全宽，侧栏/上下文转抽屉
        <div className="flex-1 relative overflow-hidden">
          <div className="flex flex-col h-full">
            {!sidebarVisible && (
              <TopBarActions
                platform={platform}
                onExpandSidebar={() => setSidebarVisible(true)}
                onCreate={handleCreate}
              />
            )}
            <div className="flex-1 min-h-0">
              <Outlet />
            </div>
          </div>
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

// 侧栏隐藏时的顶部操作条（展开侧栏 + 新建任务 + 展开右侧面板），三栏/覆盖两种模式共用
function TopBarActions({
  platform,
  onExpandSidebar,
  onCreate
}: {
  platform: Platform
  onExpandSidebar: () => void
  onCreate: () => void | Promise<void>
}) {
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onExpandSidebar}>
              <PanelLeftOpen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" className="text-xs">
            展开侧边栏
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCreate}>
              <Plus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" className="text-xs gap-1.5 flex items-center">
            <span>新建任务</span>
            <kbd className="rounded border border-primary-foreground/20 bg-primary-foreground/10 px-1.5 py-0.5 text-[10px] font-mono">
              {formatAccelerator('CmdOrCtrl+N', platform)}
            </kbd>
          </TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        {!contextPanelVisible && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setContextPanelVisible(true)}
              >
                <PanelRightOpen className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="text-xs">
              展开右侧面板
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}
