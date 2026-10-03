// ============================================================
// RootLayout — 自适应根布局
//   三栏模式 (>= 断点)：左 Sidebar(冷灰贴边) + 中内容(白色直角) + 右内容(白色直角)，
//                      侧栏与内容间无分割线，白色内容贴满顶/右/底（DeepSeek 风格）
//                      使用 ResizablePanelGroup（始终渲染 2 个 Panel，
//                      通过 collapse/expand 控显隐，避免拖拽 Bug）。
//   覆盖模式 (< 断点)：中栏全宽，Sidebar / RightPanel 转 Drawer 抽屉。
// 断点与窗口记忆按平台区分，保证各 OS 下的一致体验。
//
// 布局策略（无浮卡沟渠）：
//   - Sidebar absolute 贴左/顶/底边，全高冷灰色，与内容区无分割线（灰/白自然分界）
//   - 白色内容区 absolute 贴边（macOS top:0；Win/Linux 让出标题栏高度），
//     无圆角、无描边、无阴影；原四周 5px 沟渠已全部并入内容区
//   - ResizableHandle 宽 1px bg-border，作为中/右两块白面的分割线（保留拖拽热区）
//   - 每个 ResizablePanel 内部为独立白色直角容器
//   - TitleBar absolute 覆盖在窗口顶部左侧（macOS 仅左区）
//
// 子组件外提（问题 3 收敛）：
//   - ChatHeader / HeaderButton / TopBarActions 已外提至 layouts/ 同级文件
// ============================================================

import { useCallback, useEffect, useRef } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { PanelLeft, SquarePen } from 'lucide-react'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@/components/ui/resizable'
import { TitleBar } from './TitleBar'
import { ChatHeader } from './ChatHeader'
import { TopBarActions } from './TopBarActions'
import { HeaderButton } from './HeaderButton'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { NAV_ITEMS } from '@/components/sidebar/SidebarNav'
import { RightPanel } from '@/components/right-panel/RightPanel'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { Drawer } from '@/components/layout/Drawer'
import { useHotkeyEngine } from '@/hooks/useHotkeyEngine'
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

// 侧栏展开宽度：与 WorkBuddy / DeepSeek / 千问办公 保持一致（262px）
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
  // 插件页 / 自动化页自带顶栏（插件：Tab + 搜索/管理/添加；自动化：定时任务/运行记录），
  // 隐藏通用 ChatHeader 避免功能页标题与页内 Tab 重复。
  const isPluginsRoute = location.pathname === '/plugins'
  const isAutomationRoute = location.pathname === '/automation'
  const hidePageHeader = isPluginsRoute || isAutomationRoute
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

  // M2 快捷键引擎：接管原 useKeyboardShortcuts 的 Ctrl+B/N，
  // 并支持设置页「快捷键」分类的用户自定义绑定（appStore.hotkeys）
  useHotkeyEngine({ 'new-chat': handleCreate })

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
           三栏模式（DeepSeek 风格贴边布局）：
           - 左栏 Sidebar absolute 贴左/顶/底边（冷灰，全高，无分割线）
           - 内容容器 absolute 贴边（top/right/bottom:0；
             left 视侧边栏状态而定：展开时 262px，折叠时 0）
           - ResizablePanelGroup 填满容器
           - ResizableHandle 宽 1px bg-border，中/右白面分割线（保留 4px 拖拽热区）
           - 每个 Panel 内为独立白色直角容器（无圆角/描边/阴影）
           ============================================================ */
        <div className="absolute inset-0 overflow-hidden">
          {/* 左栏 Sidebar（与内容区之间无分割线，靠灰/白色块自然分界） */}
          <div
            className="absolute top-0 left-0 bottom-0 overflow-hidden transition-[width] duration-200 ease-out bg-sidebar"
            style={{
              width: sidebarVisible ? SIDEBAR_WIDTH : 0,
              paddingTop: sidebarVisible ? 'var(--titlebar-h)' : 0
            }}
          >
            <Sidebar />
          </div>

          {/* 白色内容区容器：贴边，无沟渠（原四周 5px 沟渠已并入内容区） */}
          <div
            className="absolute"
            style={{
              // macOS：TitleBar 只覆盖左侧 262px 区域（left-0 bg-transparent），
              //       内容区贴顶至 y=0，ChatHeader 在白面内自然显示，红绿灯浮于灰侧栏上。
              // Win/Linux：TitleBar 全宽覆盖（inset-x-0），内容区需让出顶部 titlebar 高度，
              //       否则 ChatHeader 顶部会被 TitleBar 灰底遮挡。
              top: isMac ? '0px' : 'var(--titlebar-h)',
              right: '0px',
              bottom: '0px',
              left: sidebarVisible ? `${SIDEBAR_WIDTH}px` : '0px'
            }}
            onMouseDown={handleCardMouseDown}
          >
            <ResizablePanelGroup
              autoSaveId={`pioneering-main-layout-2p-${platform}`}
              direction="horizontal"
              className="h-full w-full"
            >
              {/* 中栏：白色直角内容区 */}
              <ResizablePanel id="center" defaultSize={CENTER_INIT} minSize={30}>
                <div className="h-full w-full bg-background overflow-hidden flex flex-col relative">
                  {/* 中栏顶部栏：欢迎页 / 插件页 / 自动化页隐藏标题栏（页面自带顶栏），
                      但侧边栏折叠时仍需在左上角显示"展开侧边栏/新建任务"按钮；
                      路由感知：会话视图显示会话标题+按钮，功能页显示对应名称无会话按钮 */}
                  {!isWelcomeMode && !hidePageHeader ? (
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
                    /* 欢迎页 / 插件页 / 自动化页：侧边栏收起时在左上角显示浮动按钮
                       位置与 ChatHeader 中按钮对齐：top-2(8px) 垂直居中于 48px 标题栏高度，
                       left-4(16px) 对齐 ChatHeader 的 px-4 内边距，macOS 额外避让红绿灯 */
                    !sidebarVisible && (
                      <TooltipProvider delayDuration={200}>
                        <div
                          className="absolute top-2 left-4 z-10 flex items-center gap-1"
                          style={{ paddingLeft: 'var(--traffic-light-w)' }}
                        >
                          <HeaderButton icon={PanelLeft} title="展开侧边栏" onClick={handleToggleSidebar} />
                          <HeaderButton icon={SquarePen} title="新建任务" onClick={handleCreate} />
                        </div>
                      </TooltipProvider>
                    )
                  )}

                  <div className="flex-1 min-h-0">
                    <Outlet />
                  </div>
                </div>
              </ResizablePanel>

              {/* 中/右白面之间的 1px 分割线（bg-border），hover 时高亮；4px 隐形热区负责拖拽 */}
              <ResizableHandle className="w-px bg-border hover:bg-primary/40 transition-colors shrink-0 after:w-px" />

              {/* 右栏：白色直角内容区 */}
              <ResizablePanel
                id="context-panel"
                ref={contextRef}
                defaultSize={CONTEXT_INIT}
                minSize={15}
                maxSize={50}
                collapsible
                collapsedSize={0}
              >
                <div className="h-full w-full bg-background overflow-hidden">
                  <RightPanel />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      ) : (
        /* ============================================================
           覆盖模式（小屏抽屉）：单白色内容区贴边 + 两侧 Drawer
           与三栏模式一致：无沟渠、无圆角/描边/阴影
           ============================================================ */
        <div className="absolute inset-0 overflow-hidden" style={{paddingTop: isMac ? '0px' : 'var(--titlebar-h)'}}>
          <div className="h-full w-full bg-background overflow-hidden flex flex-col relative">
            {showTopBarActions && !isWelcomeMode && !hidePageHeader ? (
              <TopBarActions
                platform={platform}
                onExpandSidebar={() => setSidebarVisible(true)}
                onCreate={handleCreate}
              />
            ) : !sidebarVisible && (isWelcomeMode || hidePageHeader) ? (
              /* 覆盖模式欢迎页 / 插件页 / 自动化页：侧边栏收起时在左上角显示浮动按钮
                 位置与三栏模式一致：top-2(8px) left-4(16px)，macOS 额外避让红绿灯 */
              <TooltipProvider delayDuration={200}>
                <div
                  className="absolute top-2 left-4 z-10 flex items-center gap-1"
                  style={{ paddingLeft: 'var(--traffic-light-w)' }}
                >
                  <HeaderButton icon={PanelLeft} title="展开侧边栏" onClick={() => setSidebarVisible(true)} />
                  <HeaderButton icon={SquarePen} title="新建任务" onClick={handleCreate} />
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
            <RightPanel />
          </Drawer>
        </div>
      )}

      <SettingsDialog />
    </div>
  )
}
