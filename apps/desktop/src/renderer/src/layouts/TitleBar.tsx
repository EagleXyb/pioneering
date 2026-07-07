import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Minus,
  Square,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useAppStore, type WorkMode } from '@/stores/useAppStore'
import { useAtom } from 'jotai'
import { settingsOpenAtom, sidebarVisibleAtom, contextPanelVisibleAtom } from '@/stores/atoms'
import { usePlatform } from '@/hooks/usePlatform'
import { useChatStore } from '@/stores/chatStore'
import type { ImperativePanelHandle } from 'react-resizable-panels'

const modes: { id: WorkMode; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'code', label: 'Code' },
  { id: 'design', label: 'Design' }
]

interface TitleBarProps {
  onToggleContext: () => void
}

/** Windows/Linux 窗口控制按钮组（最小化 / 最大化 / 关闭） */
function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api?.window.isMaximized().then(setIsMaximized).catch(() => {})

    const cleanup = window.api?.window.onMaximizedChange?.((maximized) => {
      setIsMaximized(maximized)
    })
    return () => cleanup?.()
  }, [])

  const handleMinimize = useCallback(() => {
    window.api?.window.minimize().catch((err) => console.error('minimize failed', err))
  }, [])
  const handleMaximize = useCallback(async () => {
    try {
      await window.api?.window.maximize()
      const maximized = await window.api?.window.isMaximized()
      setIsMaximized(maximized ?? false)
    } catch (err) {
      console.error('maximize failed', err)
    }
  }, [])
  const handleClose = useCallback(() => {
    window.api?.window.close().catch((err) => console.error('close failed', err))
  }, [])

  return (
    <div className="flex items-stretch h-full">
      <button
        onClick={handleMinimize}
        className="flex items-center justify-center w-11 h-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
        title="最小化"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        onClick={handleMaximize}
        className="flex items-center justify-center w-11 h-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
        title={isMaximized ? '还原' : '最大化'}
      >
        <Square className="size-3" />
      </button>
      <button
        onClick={handleClose}
        className="flex items-center justify-center w-11 h-full text-muted-foreground/60 hover:text-white hover:bg-destructive transition-colors"
        title="关闭"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function TitleBar({ onToggleContext }: TitleBarProps) {
  const { activeMode, setActiveMode } = useAppStore()
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)
  const [, setSettingsOpen] = useAtom(settingsOpenAtom)
  const { hasNativeWindowControls, platform } = usePlatform()
  const navigate = useNavigate()
  const { createSession } = useChatStore()

  const handleCreate = async () => {
    await createSession()
    navigate('/')
  }

  // ===== 应用菜单处理函数 =====
  const handleAbout = () => {
    // TODO: 关于弹窗
    setSettingsOpen(true)
  }
  const handleCheckUpdate = () => {
    void window.api?.app?.checkUpdate?.()
  }
  const handleQuit = () => {
    void window.api?.app?.quit?.()
  }
  const handleCloseWindow = () => {
    void window.api?.window?.close?.()
  }
  const handleOpenDocs = () => {
    window.open('https://docs.pioneering.ai', '_blank')
  }
  const handleNetworkCheck = () => {
    void window.api?.app?.networkCheck?.()
  }
  const handleOpenLogDir = () => {
    void window.api?.app?.openLogDir?.()
  }
  const handleFeedback = () => {
    window.open('https://github.com/pioneering/feedback', '_blank')
  }
  const handleDevTools = () => {
    void window.api?.window?.toggleDevTools?.()
  }
  const execEdit = (cmd: string) => {
    document.execCommand(cmd)
  }
  // Win/Linux 无原生窗口控件 → 显示自定义 min/max/close；
  // platform 尚未经 IPC 初始化（'unknown'）时不渲染任何控件，避免启动闪烁。
  const showCustomControls = !hasNativeWindowControls && platform !== 'unknown'
  const isDragging = useRef(false)

  // ===== 纯 IPC 窗口拖拽（不用 -webkit-app-region，避免按钮点击被拦截） =====
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 点击目标是按钮/链接等交互元素时不启动拖拽
    const target = e.target as HTMLElement
    if (target.closest('button, a, [role="button"], input, textarea, select')) return
    isDragging.current = true
    window.api?.window.startDrag(e.screenX, e.screenY)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      if (!isDragging.current) return
      window.api?.window.moveDrag(e.screenX, e.screenY)
    }
    const handleMouseUp = (): void => {
      if (!isDragging.current) return
      isDragging.current = false
      window.api?.window.endDrag()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  return (
    <header
      className="flex items-center border-b border-border bg-background/95 backdrop-blur select-none shrink-0"
      // 平台差异全部经 CSS 变量下发：高度、左右留白由 data-platform 决定，
      // 不再写 w-[70px] 之类的魔法数，左右对称保证 mode 切换真正居中。
      style={{
        height: 'var(--titlebar-h)',
        paddingLeft: 'var(--titlebar-leading)',
        paddingRight: 'var(--titlebar-trailing)'
      }}
      onMouseDown={handleMouseDown}
    >
      {/* App Menus: Pioneering / 编辑 / 窗口 / 帮助 */}
      <div className="flex items-center shrink-0">
        {/* Pioneering */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-sm transition-colors outline-none">
              Pioneering
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-48">
            <DropdownMenuItem onSelect={handleAbout}>
              关于 Pioneering
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleCheckUpdate}>
              检查更新
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleQuit}>
              退出 Pioneering
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 编辑 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-sm transition-colors outline-none">
              编辑
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-44">
            <DropdownMenuItem onSelect={() => execEdit('undo')}>
              撤销
              <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => execEdit('redo')}>
              重做
              <DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => execEdit('cut')}>
              剪切
              <DropdownMenuShortcut>⌘X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => execEdit('copy')}>
              复制
              <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => execEdit('paste')}>
              粘贴
              <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => execEdit('selectAll')}>
              全选
              <DropdownMenuShortcut>⌘A</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 窗口 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-sm transition-colors outline-none">
              窗口
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-44">
            <DropdownMenuItem onSelect={handleCloseWindow}>
              关闭窗口
              <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 帮助 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-sm transition-colors outline-none">
              帮助
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-44">
            <DropdownMenuItem onSelect={handleOpenDocs}>
              使用文档
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleNetworkCheck}>
              网络检查
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleOpenLogDir}>
              打开日志目录
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleFeedback}>
              意见反馈
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleDevTools}>
              开发者工具
              <DropdownMenuShortcut>⌘⇧I</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Left: 侧边栏折叠态 — 展开按钮 + 新建任务 */}
      <div className="flex items-center gap-1 px-2">
        {!sidebarVisible && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSidebarVisible(true)}
              title="展开侧边栏"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleCreate}
              title="新建任务"
            >
              <Plus className="size-4" />
            </Button>
          </>
        )}
      </div>

      {/* Center: mode switching（左右留白对称，flex-1 容器内真正居中） */}
      <div className="flex-1 flex items-center justify-center">
        <div className="bg-muted rounded-lg p-0.5 flex items-center">
          {modes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setActiveMode(mode.id)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                activeMode === mode.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right: context panel toggle */}
      <div className="flex items-center gap-1 px-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleContext}
          title="Toggle Context Panel"
        >
          {contextPanelVisible ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
        </Button>
      </div>

      {/* Windows/Linux: custom window controls (min/max/close) */}
      {showCustomControls && <WindowControls />}
    </header>
  )
}
