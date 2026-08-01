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
  PanelLeft,
  Plus,
  MessageCirclePlus,
  PanelRight,
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
import { useAtom, useAtomValue } from 'jotai'
import {
  sidebarVisibleAtom,
  contextPanelVisibleAtom,
  chatScrolledAtom
} from '@/stores/atoms'
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

          {/* 白色卡片区域容器：四周 5px 沟渠 */}
          <div
            className="absolute"
            style={{
              top: '5px',
              right: '5px',
              bottom: '5px',
              left: sidebarVisible ? `calc(${SIDEBAR_WIDTH}px + 5px)` : '5px'
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
                <div className="h-full w-full bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/5 overflow-hidden flex flex-col" style={{ borderRadius: 6 }}>
                  {/* 中栏顶部栏：常驻渲染；侧边栏折叠时左侧显示"展开侧边栏/新建任务"按钮 */}
                  <ChatHeader
                    title={currentTitle || '新对话'}
                    contextPanelVisible={contextPanelVisible}
                    onToggleContext={() => setContextPanelVisible(!contextPanelVisible)}
                    sidebarVisible={sidebarVisible}
                    onToggleSidebar={handleToggleSidebar}
                    onCreate={handleCreate}
                  />

                  <div className="flex-1 min-h-0">
                    <Outlet />
                  </div>
                </div>
              </ResizablePanel>

              {/* 中卡片与右卡片之间的沟渠：1px 拖拽线，hover 时显示高亮线 */}
              <ResizableHandle className="w-px bg-transparent hover:bg-primary/40 transition-colors shrink-0 rounded-sm after:w-px" />

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
                <div className="h-full w-full bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/5 overflow-hidden" style={{ borderRadius: 6 }}>
                  <ContextPanel />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      ) : (
        /* ============================================================
           覆盖模式（小屏抽屉）：单白色卡片 + 两侧 Drawer
           与三栏模式一致：卡片四周 3px 沟渠
           ============================================================ */
        <div className="absolute inset-0 overflow-hidden p-[5px]" style={{paddingTop: isMac ? '5px' : 'var(--titlebar-h)'}}>
          <div className="h-full w-full bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/5 overflow-hidden flex flex-col" style={{ borderRadius: 6 }}>
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

/* ChatHeader — 中栏会话顶部栏
   卡片有 5px top 沟渠，按钮自然位于 Y=29px；
   左栏 MacTitleBar 的按钮也使用 pt-[5px] 下移对齐 */
function ChatHeader({
  title,
  contextPanelVisible,
  onToggleContext,
  sidebarVisible,
  onToggleSidebar,
  onCreate
}: {
  title: string
  contextPanelVisible: boolean
  onToggleContext: () => void
  sidebarVisible: boolean
  onToggleSidebar: () => void
  onCreate: () => void | Promise<void>
}) {
  // 消息区滚动离开顶部时显示下边框；在顶部/无滚动内容时隐藏
  // （始终保留 border-b 的 1px 空间并仅切换颜色，避免边框显隐引起 1px 布局抖动）
  const isChatScrolled = useAtomValue(chatScrolledAtom)

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          'flex items-center h-[var(--titlebar-h)] shrink-0 px-4 select-none border-b border-transparent',
          isChatScrolled && 'border-border/50'
        )}
      >
        {/* 侧边栏折叠时：展开侧边栏 + 新建任务（三平台统一入口）；
            macOS 下左侧留出红绿灯避让区（--traffic-light-w）避免重叠 */}
        {!sidebarVisible && (
          <div
            className="flex items-center gap-1 mr-3"
            style={{ paddingLeft: 'var(--traffic-light-w)' }}
          >
            <HeaderButton icon={PanelLeft} title="展开侧边栏" onClick={onToggleSidebar} />
            <HeaderButton icon={MessageCirclePlus} title="新建任务" onClick={onCreate} />
          </div>
        )}
        {/* 会话标题：展开状态下左侧留 9px 边距（16px 容器内边距 + 9px ≈ 25px 距卡片左缘） */}
        <span
          className={cn(
            'text-[16px] font-semibold text-foreground truncate',
            sidebarVisible && 'ml-[9px]'
          )}
        >
          {title}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <HeaderButton icon={Search} title="在会话中搜索" />
          <HeaderButton icon={Share2} title="分享" />
          <HeaderButton icon={History} title="历史记录" />
          {/* 右侧面板展开时不显示收起入口，折叠时显示展开入口 */}
          {!contextPanelVisible && (
            <HeaderButton
              icon={PanelRight}
              title="展开右侧面板"
              onClick={onToggleContext}
            />
          )}
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

// 覆盖模式（小屏抽屉）的顶部操作条：仅 Win/Linux 使用（macOS 由 MacTitleBar 承担）
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
              <PanelLeft className="size-4" />
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
                <PanelRight className="size-4" />
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
