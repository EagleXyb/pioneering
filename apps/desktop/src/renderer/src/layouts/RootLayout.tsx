// ============================================================
// RootLayout — 自适应根布局
//   三栏模式 (>= 断点)：左 Sidebar(灰色贴边) + 中卡片(白色圆角) + 右卡片(白色圆角)，
//                      卡片间 6px 灰色沟渠，卡片四周 6px 灰色边距
//                      使用 ResizablePanelGroup（始终渲染 3 个 Panel，
//                      通过 collapse/expand 控显隐，避免拖拽 Bug）。
//   覆盖模式 (< 断点)：中栏全宽，Sidebar / ContextPanel 转 Drawer 抽屉。
// 断点与窗口记忆按平台区分，保证各 OS 下的一致体验。
//
// 布局策略（截图标配）：
//   - 窗口底色始终为 bg-sidebar（灰色），作为沟渠/边框色
//   - Sidebar absolute 贴左/顶/底边，无外间距（全高灰色）
//   - 白色卡片区域 absolute 定位，四周 6px 间距（沟渠）
//   - ResizableHandle 宽 6px 透明，作为两卡片间的沟渠（透显灰色底色）
//   - 每个 ResizablePanel 内部用独立白色圆角卡片包裹
//   - TitleBar absolute 覆盖在窗口顶部左侧（macOS 仅左区）
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
  PanelRightClose,
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
      className="relative h-screen w-screen overflow-hidden text-foreground bg-sidebar"
    >
      {/* TitleBar 覆盖在窗口顶部 */}
      <TitleBar
        sidebarVisible={sidebarVisible}
        onToggleSidebar={handleToggleSidebar}
        onCreate={handleCreate}
      />

      {mode === 'three-column' ? (
        /* ============================================================
           三栏模式：
           - 左栏 Sidebar absolute 贴左/顶/底边（灰色，全高，无外间距）
           - 卡片容器 absolute 定位，四周 6px 沟渠（top/right/bottom 固定 6px，
             left 视侧边栏状态而定：展开时 262+6=268px，折叠时 6px）
           - ResizablePanelGroup 填满容器，底色透明（透显灰色）
           - ResizableHandle 宽 6px 作为两卡片间沟渠（透显灰色底色）
           - 每个 Panel 内包裹独立白色圆角卡片（rounded-[10px] shadow ring overflow-hidden）
           ============================================================ */
        <div className="absolute inset-0 overflow-hidden">
          {/* 左栏 Sidebar */}
          <div
            className={cn(
              'absolute top-0 left-0 bottom-0 overflow-hidden transition-[width] duration-200 ease-out bg-sidebar',
              sidebarVisible && 'border-r border-border/0' /* 无分割线，靠沟渠分隔 */
            )}
            style={{
              width: sidebarVisible ? SIDEBAR_WIDTH : 0,
              paddingTop: sidebarVisible ? 'var(--titlebar-h)' : 0
            }}
          >
            <Sidebar />
          </div>

          {/* 白色卡片区域容器：透明底色，由各 panel 内卡片承载白色 */}
          <div
            className="absolute"
            style={{
              top: '0.375rem',
              right: '0.375rem',
              bottom: '0.375rem',
              left: sidebarVisible ? `calc(${SIDEBAR_WIDTH}px + 0.375rem)` : '0.375rem'
            }}
            onMouseDown={handleCardMouseDown}
          >
            <ResizablePanelGroup
              autoSaveId={`pioneering-main-layout-2p-${platform}`}
              direction="horizontal"
              className="h-full w-full"
            >
              {/* 中栏：独立白色圆角卡片 */}
              <ResizablePanel id="center" defaultSize={CENTER_INIT} minSize={30}>
                <div className="h-full w-full bg-background rounded-[10px] shadow-sm ring-1 ring-black/5 dark:ring-white/5 overflow-hidden flex flex-col">
                  {/* Win/Linux 折叠时的操作条 */}
                  {showTopBarActions && (
                    <TopBarActions
                      platform={platform}
                      onExpandSidebar={() => setSidebarVisible(true)}
                      onCreate={handleCreate}
                    />
                  )}

                  {/* 展开时显示中栏顶部栏 */}
                  {sidebarVisible && (
                    <ChatHeader
                      title={currentTitle || '新对话'}
                      contextPanelVisible={contextPanelVisible}
                      onToggleContext={() => setContextPanelVisible(!contextPanelVisible)}
                    />
                  )}

                  <div className="flex-1 min-h-0">
                    <Outlet />
                  </div>
                </div>
              </ResizablePanel>

              {/* 中卡片与右卡片之间的沟渠：6px 宽透明，透显底层灰色 */}
              <ResizableHandle className="w-1.5 bg-transparent hover:bg-primary/20 transition-colors shrink-0 rounded-sm" />

              {/* 右栏：独立白色圆角卡片 */}
              <ResizablePanel
                id="context-panel"
                ref={contextRef}
                defaultSize={CONTEXT_INIT}
                minSize={15}
                maxSize={50}
                collapsible
                collapsedSize={0}
              >
                <div className="h-full w-full bg-background rounded-[10px] shadow-sm ring-1 ring-black/5 dark:ring-white/5 overflow-hidden">
                  <ContextPanel />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      ) : (
        /* ============================================================
           覆盖模式（小屏抽屉）：单白色卡片 + 两侧 Drawer
           与三栏模式一致：卡片四周 6px 沟渠
           ============================================================ */
        <div className="absolute inset-0 p-1.5 overflow-hidden" style={{paddingTop: isMac ? '0.375rem' : 'var(--titlebar-h)'}}>
          <div className="h-full w-full bg-background rounded-[10px] shadow-sm ring-1 ring-black/5 dark:ring-white/5 overflow-hidden flex flex-col">
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
function ChatHeader({
  title,
  contextPanelVisible,
  onToggleContext
}: {
  title: string
  contextPanelVisible: boolean
  onToggleContext: () => void
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="flex items-center h-[var(--titlebar-h)] shrink-0 px-4 select-none border-b border-border"
      >
        <span className="text-[15px] font-semibold text-foreground truncate">{title}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          <HeaderButton icon={Search} title="在会话中搜索" />
          <HeaderButton icon={Share2} title="分享" />
          <HeaderButton icon={History} title="历史记录" />
          <HeaderButton
            icon={contextPanelVisible ? PanelRightClose : PanelRightOpen}
            title={contextPanelVisible ? '收起右侧面板' : '展开右侧面板'}
            onClick={onToggleContext}
          />
        </div>
      </div>
    </TooltipProvider>
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
