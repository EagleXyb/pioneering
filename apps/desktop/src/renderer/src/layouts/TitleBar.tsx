import { useState, useEffect, useCallback, useRef } from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Minus,
  Square,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore, type WorkMode } from '@/stores/useAppStore'
import { useAtom } from 'jotai'
import { sidebarVisibleAtom, contextPanelVisibleAtom, settingsOpenAtom } from '@/stores/atoms'
import { usePlatform } from '@/hooks/usePlatform'
import type { ImperativePanelHandle } from 'react-resizable-panels'

const modes: { id: WorkMode; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'code', label: 'Code' },
  { id: 'design', label: 'Design' }
]

interface TitleBarProps {
  sidebarRef?: React.RefObject<ImperativePanelHandle | null>
  contextRef?: React.RefObject<ImperativePanelHandle | null>
}

/** Windows 窗口控制按钮组（最小化 / 最大化 / 关闭） */
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

export function TitleBar({ sidebarRef, contextRef }: TitleBarProps) {
  const { activeMode, setActiveMode } = useAppStore()
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)
  const [, setSettingsOpen] = useAtom(settingsOpenAtom)
  const { isMac, isWindows, isLinux, platform } = usePlatform()
  // Windows/Linux 无原生窗口控件，使用自定义 min/max/close 按钮组；
  // 在 platformAtom 尚未经 IPC 初始化（'unknown'）时也回退到自定义控件，
  // 避免异常情况下用户无任何窗口操作入口
  const showCustomControls = isWindows || isLinux || platform === 'unknown'
  const isDragging = useRef(false)

  const toggleSidebar = () => {
    const p = sidebarRef?.current
    if (sidebarVisible) {
      p?.collapse()
    } else {
      p?.expand()
    }
    setSidebarVisible(!sidebarVisible)
  }

  const toggleContextPanel = () => {
    const p = contextRef?.current
    if (contextPanelVisible) {
      p?.collapse()
    } else {
      p?.expand()
    }
    setContextPanelVisible(!contextPanelVisible)
  }

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
      className="flex items-center h-10 border-b border-border bg-background/95 backdrop-blur select-none shrink-0"
      onMouseDown={handleMouseDown}
    >
      {/* Mac: left spacing for native traffic lights */}
      {isMac && <div className="w-[70px] shrink-0" />}

      {/* Left: sidebar toggle */}
      <div className="flex items-center gap-1 px-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={toggleSidebar}
          title="Toggle Sidebar"
        >
          {sidebarVisible ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </Button>
      </div>

      {/* Center: mode switching */}
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

      {/* Right: context panel toggle + settings */}
      <div className="flex items-center gap-1 px-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={toggleContextPanel}
          title="Toggle Context Panel"
        >
          {contextPanelVisible ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="size-4" />
        </Button>
      </div>

      {/* Windows/Linux: custom window controls (min/max/close) */}
      {showCustomControls && <WindowControls />}
    </header>
  )
}
