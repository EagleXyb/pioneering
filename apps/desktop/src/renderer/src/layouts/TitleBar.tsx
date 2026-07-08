import { useState, useEffect, useCallback, useRef, memo } from 'react'
import {
  PanelRightClose,
  PanelRightOpen,
  Minus,
  Square,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore, type WorkMode } from '@/stores/useAppStore'
import { useAtom } from 'jotai'
import { contextPanelVisibleAtom } from '@/stores/atoms'
import { usePlatform } from '@/hooks/usePlatform'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { windowApi } from '@/services/ipc'
import { menuTemplate } from '@shared/menu-template'
import { MenuDropdown } from '@/menu/MenuDropdown'

const modes: { id: WorkMode; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'code', label: 'Code' },
  { id: 'design', label: 'Design' }
]

interface TitleBarProps {
  onToggleContext: () => void
}

/** Windows/Linux 窗口控制按钮组（最小化 / 最大化 / 关闭） */
const WindowControls = memo(function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    windowApi.isMaximized().then(setIsMaximized).catch(() => {})

    const cleanup = windowApi.onMaximizedChange?.((maximized) => {
      setIsMaximized(maximized)
    })
    return () => cleanup?.()
  }, [])

  const handleMinimize = useCallback(() => {
    windowApi.minimize().catch((err) => console.error('minimize failed', err))
  }, [])
  const handleMaximize = useCallback(async () => {
    try {
      await windowApi.maximize()
      const maximized = await windowApi.isMaximized()
      setIsMaximized(maximized ?? false)
    } catch (err) {
      console.error('maximize failed', err)
    }
  }, [])
  const handleClose = useCallback(() => {
    windowApi.close().catch((err) => console.error('close failed', err))
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
})

export const TitleBar = memo(function TitleBar({ onToggleContext }: TitleBarProps) {
  // 订阅粒度细化：仅订阅所需字段，避免 useAppStore() 全量订阅导致的无关重渲染（P2-3）
  const activeMode = useAppStore((s) => s.activeMode)
  const setActiveMode = useAppStore((s) => s.setActiveMode)
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)
  const { hasNativeWindowControls, platform, showInWindowMenu } = usePlatform()

  // 菜单处理函数已收敛到 shared/menu-template + renderer/src/menu/menuActions（数据驱动）
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
    windowApi.startDrag(e.screenX, e.screenY)
  }, [])

  useEffect(() => {
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
  }, [])

  return (
    <header
      className="flex items-center border-b border-border bg-background/95 backdrop-blur select-none shrink-0"
      style={{
        height: 'var(--titlebar-h)',
        paddingLeft: 'var(--titlebar-leading)',
        paddingRight: 'var(--titlebar-trailing)'
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 平台差异全部经 CSS 变量下发：高度、左右留白由 data-platform 决定，
          不再写 w-[70px] 之类的魔法数，左右对称保证 mode 切换真正居中。 */}
      {/* App Menus: 数据驱动渲染（macOS 走全局栏，故窗口内仅 Win/Linux 渲染） */}
      {showInWindowMenu && (
        <div className="flex items-center shrink-0">
          {menuTemplate.map((menu) => (
            <MenuDropdown key={menu.label} item={menu} platform={platform} />
          ))}
        </div>
      )}

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
})
