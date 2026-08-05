// ============================================================
// RootLayout — 自适应根布局
//   三栏模式 (>= 断点)：左 Sidebar(灰色贴边) + 中卡片(白色圆角) + 右卡片(白色圆角)，
//                      卡片间 1px 灰色沟渠，卡片四周 5px 灰色边距
//                      使用 ResizablePanelGroup（始终渲染 2 个 Panel，
//                      通过 collapse/expand 控显隐，避免拖拽 Bug）。
//   覆盖模式 (< 断点)：中栏全宽，Sidebar / ContextPanel 转 Drawer 抽屉。
// 断点与窗口记忆按平台区分，保证各 OS 下的一致体验。
//
// 布局策略：
//   - 窗口底色始终为 bg-sidebar（灰色），作为沟渠/边框色
//   - Sidebar absolute 贴左/顶/底边，无外间距（全高灰色）
//   - 白色卡片区域 absolute 定位，四周 5px 间距（沟渠）
//   - ResizableHandle 宽 1px 透明，作为两卡片间的沟渠（透显灰色底色）
//   - 每个 ResizablePanel 内部用独立白色圆角卡片包裹
//   - TitleBar absolute 覆盖在窗口顶部左侧（macOS 仅左区）
//
// 子组件外提（问题 3 收敛）：
//   - ChatHeader / HeaderButton / TopBarActions 已外提至 layouts/ 同级文件
// ============================================================

import { useCallback, useEffect, useRef } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { PanelLeft, MessageCirclePlus } from 'lucide-react'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@/components/ui/resizable'
import { cn } from '@/lib/utils'
import { TitleBar } from './TitleBar'
import { ChatHeader } from './ChatHeader'
import { TopBarActions } from './TopBarActions'
import { HeaderButton } from './HeaderButton'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { NAV_ITEMS } from '@/components/sidebar/SidebarNav'
import { ContextPanel } from '@/components/context-panel/ContextPanel'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { Drawer } from '@/components/layout/Drawer'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAtom, useAtomValue } from 'jotai'
import {
  sidebarVisibleAtom,
  contextPanelVisibleAtom,
  chatWelcomeModeAtom
} from '@/stores/atoms'
import { TooltipProvider } from '@/components/ui/tooltip'
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
  const isWelcomeMode = useAtomValue(chatWelcomeModeAtom)
  const navigate = useNavigate()
  const location = useLocation()
  const { sessions, currentSessionId, startNewTask } = useChatStore()

  const currentSession = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
    : null

  // ============================================================
  // 顶部栏模式判定（路由感知，与 Sidebar.activeNavKey 同源）：
  //   - 路径 '/' 或 '' → 会话视图：标题取会话 title，显示搜索/分享/历史/右面板
  //   - 路径匹配 NAV_ITEMS.route → 功能页视图：标题取对应 label，隐藏会话按钮
  //   - 其余路径（/home /workspace）→ 兜底会话视图（后续可按需要扩展）
  // ============================================================
  const matchedNav = NAV_ITEMS.find((i) => i.route === location.pathname)
  const isChatView = !matchedNav && (location.pathname === '/' || location.pathname === '')
  const headerTitle = matchedNav
    ? matchedNav.label
    : currentSession?.title || '新对话'
  const showSessionActions = isChatView

  const handleCreate = useCallback(async () => {
    // Lazy Create：仅进入 draft 态（标题栏新建 / Cmd+N 快捷键），不创建后端会话
    startNewTask()
    navigate('/')
  }, [startNewTask, navigate])

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
           - 卡片容器 absolute 定位，四周 5px 沟渠（top/right/bottom 固定 5px，
             left 视侧边栏状态而定：展开时 262+5=267px，折叠时 5px）
           - ResizablePanelGroup 填满容器，底色透明（透显灰色）
           - ResizableHandle 宽 1px 透明，作为两卡片间沟渠（透显灰色底色）
           - 每个 Panel 内包裹独立白色圆角卡片
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
              // macOS：TitleBar 只覆盖左侧 262px 区域（left-0 bg-transparent），
              //       中栏从 left=267 开始横向不与 TitleBar 重叠，卡片可用 5px 顶部沟渠。
              // Win/Linux：TitleBar 全宽覆盖（inset-x-0），卡片需让出顶部 titlebar 高度，
              //       否则 ChatHeader 顶部会被 TitleBar 灰底遮挡。
              top: isMac ? '5px' : 'var(--titlebar-h)',
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
                <div className="h-full w-full bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/5 overflow-hidden flex flex-col relative" style={{ borderRadius: 6 }}>
                  {/* 中栏顶部栏：欢迎页模式下隐藏标题栏（输入框居中、无标题干扰），
                      但侧边栏折叠时仍需在左上角显示"展开侧边栏/新建任务"按钮；
                      路由感知：会话视图显示会话标题+按钮，功能页显示对应名称无会话按钮 */}
                  {!isWelcomeMode ? (
                    <ChatHeader
                      title={headerTitle}
                      contextPanelVisible={contextPanelVisible}
                      onToggleContext={() => setContextPanelVisible(!contextPanelVisible)}
                      sidebarVisible={sidebarVisible}
                      onToggleSidebar={handleToggleSidebar}
                      onCreate={handleCreate}
                      showSessionActions={showSessionActions}
                    />
                  ) : (
                    /* 欢迎页模式：侧边栏收起时在左上角显示浮动按钮
                       位置与 ChatHeader 中按钮对齐：top-2(8px) 垂直居中于 48px 标题栏高度，
                       left-4(16px) 对齐 ChatHeader 的 px-4 内边距，macOS 额外避让红绿灯 */
                    !sidebarVisible && (
                      <TooltipProvider delayDuration={200}>
                        <div
                          className="absolute top-2 left-4 z-10 flex items-center gap-1"
                          style={{ paddingLeft: 'var(--traffic-light-w)' }}
                        >
                          <HeaderButton icon={PanelLeft} title="展开侧边栏" onClick={handleToggleSidebar} />
                          <HeaderButton icon={MessageCirclePlus} title="新建任务" onClick={handleCreate} />
                        </div>
                      </TooltipProvider>
                    )
                  )}

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
           与三栏模式一致：卡片四周 5px 沟渠
           ============================================================ */
        <div className="absolute inset-0 overflow-hidden p-[5px]" style={{paddingTop: isMac ? '5px' : 'var(--titlebar-h)'}}>
          <div className="h-full w-full bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/5 overflow-hidden flex flex-col relative" style={{ borderRadius: 6 }}>
            {showTopBarActions && !isWelcomeMode ? (
              <TopBarActions
                platform={platform}
                onExpandSidebar={() => setSidebarVisible(true)}
                onCreate={handleCreate}
              />
            ) : !sidebarVisible && isWelcomeMode ? (
              /* 覆盖模式欢迎页：侧边栏收起时在左上角显示浮动按钮
                 位置与三栏模式欢迎页一致：top-2(8px) left-4(16px)，macOS 额外避让红绿灯 */
              <TooltipProvider delayDuration={200}>
                <div
                  className="absolute top-2 left-4 z-10 flex items-center gap-1"
                  style={{ paddingLeft: 'var(--traffic-light-w)' }}
                >
                  <HeaderButton icon={PanelLeft} title="展开侧边栏" onClick={() => setSidebarVisible(true)} />
                  <HeaderButton icon={MessageCirclePlus} title="新建任务" onClick={handleCreate} />
                </div>
              </TooltipProvider>
            ) : null}
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
