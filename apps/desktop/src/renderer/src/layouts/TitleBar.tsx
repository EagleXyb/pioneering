import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { windowApi } from '@/services/ipc'
import { usePlatform } from '@/hooks/usePlatform'
import { menuTemplate } from '@shared/menu-template'
import { MenuDropdown } from '@/menu/MenuDropdown'
import { MacTitleBar } from './MacTitleBar'
import { cn } from '@/lib/utils'

interface TitleBarProps {
  sidebarVisible: boolean
  onToggleSidebar: () => void
  onCreate: () => void | Promise<void>
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
        className="flex items-center justify-center w-11 h-full text-muted-foreground/60 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        title="最小化"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        onClick={handleMaximize}
        className="flex items-center justify-center w-11 h-full text-muted-foreground/60 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
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

export const TitleBar = memo(function TitleBar({
  sidebarVisible,
  onToggleSidebar,
  onCreate
}: TitleBarProps) {
  const { hasNativeWindowControls, platform, showInWindowMenu, isMac, isFullscreen } =
    usePlatform()

  const showCustomControls = !hasNativeWindowControls && platform !== 'unknown'
  const isDragging = useRef(false)

  // ===== 纯 IPC 窗口拖拽 =====
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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

  const headerStyle: React.CSSProperties = {
    height: 'var(--titlebar-h)'
  }
  if (!isMac) {
    headerStyle.paddingLeft = 'var(--titlebar-leading)'
    headerStyle.paddingRight = 'var(--titlebar-trailing)'
  }

  return (
    <header
      className={cn(
        // 绝对定位在窗口顶部
        // macOS：只覆盖左侧区域（left-0 top-0，不设 right-0/inset-x-0），
        //        右侧留给白色卡片的 ChatHeader/ContextPanel header 自然显示
        // Win/Linux：全宽（inset-x-0），包含菜单和窗口控制按钮
        'absolute top-0 z-20 flex items-center select-none h-[var(--titlebar-h)]',
        isMac ? 'left-0 bg-transparent pointer-events-none' : 'inset-x-0 bg-sidebar pointer-events-auto'
      )}
      style={isMac ? undefined : headerStyle}
      onMouseDown={isMac ? undefined : handleMouseDown}
    >
      {isMac ? (
        <MacTitleBar
          sidebarVisible={sidebarVisible}
          isFullscreen={isFullscreen}
          onToggleSidebar={onToggleSidebar}
          onDragMouseDown={handleMouseDown}
        />
      ) : (
        <>
          {showInWindowMenu && (
            <div className="flex items-center shrink-0">
              {menuTemplate.map((menu) => (
                <MenuDropdown key={menu.label} item={menu} platform={platform} />
              ))}
            </div>
          )}

          <div className="flex-1" />

          {showCustomControls && <WindowControls />}
        </>
      )}
    </header>
  )
})
