// ============================================================
// RootLayout — 自适应根布局
//   三栏模式 (>= 断点)：左 Sidebar + 中内容 + 右 ContextPanel，
//                      使用 ResizablePanelGroup（始终渲染 3 个 Panel，
//                      通过 collapse/expand 控显隐，避免拖拽 Bug）。
//   覆盖模式 (< 断点)：中栏全宽，Sidebar / ContextPanel 转 Drawer 抽屉。
// 断点与窗口记忆按平台区分，保证各 OS 下的一致体验。
//
// 布局策略：
//   TitleBar 使用 absolute 覆盖在窗口顶部，
//   内容区（Sidebar + 中+右卡片）使用 inset:0 从窗口顶部开始布局，
//   这样中栏/右栏的 header 可以自然地位于标题栏行（与红绿灯同高），
//   实现 WorkBuddy 风格：左灰区 + 中栏标题栏 + 右栏面板栏 三段并列。
// ============================================================

import { useCallback, useEffect, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@/components/ui/resizable'
import {
  PanelLeftOpen,
  Plus,
  PanelRightOpen,
  Search,
  Share2,
  History
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
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
import { windowApi } from '@/services/ipc'

const SIDEBAR_WIDTH = 262
const CENTER_INIT = 65
const CONTEXT_INIT = 35

export function RootLayout() {
  const { platform, isMac } = usePlatform()
  const { contextRef, mode } = usePanelToggle()
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)
  const navigate = useNavigate()
  const { createSession, sessions, currentSessionId } = useChatStore()

  const currentSession = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
    : null
  const currentTitle = currentSession?.title
  const hasActiveSession = !!currentTitle

  const handleCreate = useCallback(async () => {
    await createSession()
    navigate('/')
  }, [createSession, navigate])

  const handleToggleSidebar = useCallback(() => {
    setSidebarVisible(!sidebarVisible)
  }, [sidebarVisible, setSidebarVisible])

  useKeyboardShortcuts(handleCreate)

  const showTopBarActions = !isMac && !sidebarVisible

  // 窗口拖拽：挂在白色卡片空白区域，复用 TitleBar 的纯 IPC 拖拽逻辑
  const isDragging = useRef(false)
  const handleCardMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isMac) return // Win/Linux 拖拽由标题栏处理
    const target = e.target as HTMLElement
    if (target.closest('button, a, [role="button"], input, textarea, select')) return
    isDragging.current = true
    windowApi.startDrag(e.screenX, e.screenY)
  }, [isMac])

  useEffect(() => {
    if (!isMac) return
    const handleMouseMove = (e: MouseEvent): void => {
      if (!isDragging.current) return
      windowApi.moveDrag(e.screenX, e.screenY)
    }
    const handleMouseUp = (): void => {
      if (!isDragging.current) return
      isDragging.current = false
      windowApi.endDrag()
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isMac])

  return (
    <div
      className={cn(
        'relative h-screen w-screen overflow-hidden text-foreground',
        sidebarVisible ? 'bg-sidebar' : 'bg-background'
      )}
    >
      {/* TitleBar 覆盖在窗口顶部 */}
      <TitleBar
        sidebarVisible={sidebarVisible}
        onToggleSidebar={handleToggleSidebar}
        onCreate={handleCreate}
      />

      {mode === 'three-column' ? (
        /* ============================================================
           三栏模式：内容区 inset:0 从窗口最顶部开始
           ============================================================ */
        <div className="absolute inset-0 flex overflow-hidden">
          {/* 左栏 Sidebar：展开时需要 pt-[var(--titlebar-h)] 避开标题栏，
              折叠时 width=0，内容自然隐藏 */}
          <div
            className={cn(
              'shrink-0 overflow-hidden transition-[width] duration-200 ease-out bg-sidebar',
              sidebarVisible && 'border-r border-border'
            )}
            style={{
              width: sidebarVisible ? SIDEBAR_WIDTH : 0,
              paddingTop: sidebarVisible ? 'var(--titlebar-h)' : 0
            }}
          >
            <Sidebar />
          </div>

          {/* 中栏 + 右栏白色卡片容器
              macOS 展开：从 y=0 开始（卡片顶部与标题栏行齐平），右上角+右下角圆角，右/下留沟渠
              Win/Linux 展开：从 TitleBar 下方开始（上留 6px 沟渠），完整圆角
              折叠：平铺无卡片，加 pt 让内容从 TitleBar 下方开始 */}
          <div
            className={cn(
              'flex-1 flex min-w-0',
              sidebarVisible
                ? [
                    'overflow-hidden bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/5',
                    isMac
                      ? 'rounded-tr-[10px] rounded-br-[10px] mr-1.5 mb-1.5'
                      : 'rounded-[10px] mt-[calc(var(--titlebar-h)+0.375rem)] mr-1.5 mb-1.5'
                  ]
                : 'pt-[var(--titlebar-h)]'
            )}
            onMouseDown={handleCardMouseDown}
          >
            <ResizablePanelGroup
              autoSaveId={`pioneering-main-layout-2p-${platform}`}
              direction="horizontal"
              className="flex-1 h-full"
            >
              {/* 中栏 */}
              <ResizablePanel id="center" defaultSize={CENTER_INIT} minSize={30}>
                <div className="flex flex-col h-full">
                  {/* Win/Linux 折叠时的操作条 */}
                  {showTopBarActions && (
                    <TopBarActions
                      platform={platform}
                      onExpandSidebar={() => setSidebarVisible(true)}
                      onCreate={handleCreate}
                    />
                  )}

                  {/* 展开时显示中栏顶部栏（会话标题/新对话），与右栏header同级并列 */}
                  {sidebarVisible && (
                    <ChatHeader title={currentTitle || '新对话'} />
                  )}

                  <div className="flex-1 min-h-0">
                    <Outlet />
                  </div>
                </div>
              </ResizablePanel>

              {/* 垂直分割线：从上到下贯穿，包括header区域 */}
              <ResizableHandle className="w-px bg-border hover:bg-primary/50 transition-colors shrink-0" />

              {/* 右栏 */}
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
        </div>
      ) : (
        /* ============================================================
           覆盖模式（小屏抽屉）
           ============================================================ */
        <div className="absolute inset-0 pt-[var(--titlebar-h)] overflow-hidden">
          <div className="flex flex-col h-full">
            {showTopBarActions && (
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

      <SettingsDialog />
    </div>
  )
}

// ============================================================
// ChatHeader — 中栏会话顶部栏（与右栏 ContextPanel header 同级别并列）
// ============================================================
function ChatHeader({ title }: { title: string }) {
  return (
    <div
      className="flex items-center h-[var(--titlebar-h)] shrink-0 px-4 select-none border-b border-border"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="text-[15px] font-semibold text-foreground truncate">{title}</span>
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        <HeaderButton icon={Search} title="在会话中搜索" />
        <HeaderButton icon={Share2} title="分享" />
        <HeaderButton icon={History} title="历史记录" />
      </div>
    </div>
  )
}

function HeaderButton({
  icon: Icon,
  onClick,
  title
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  onClick?: () => void
  title: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 rounded-md"
          onClick={onClick}
        >
          <Icon size={18} strokeWidth={1.5} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" className="text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

// 侧栏隐藏时的顶部操作条（仅 Win/Linux 使用）
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
