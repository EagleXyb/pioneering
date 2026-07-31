import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { windowApi } from '@/services/ipc'
import { usePlatform } from '@/hooks/usePlatform'
import { menuTemplate } from '@shared/menu-template'
import { MenuDropdown } from '@/menu/MenuDropdown'

interface TitleBarProps {
  // 无外部 props（菜单/窗口控件自包含）
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

export const TitleBar = memo(function TitleBar(_props: TitleBarProps) {
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
      className="flex items-center bg-[#EDEFF2] select-none shrink-0"
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

      {/* Spacer: push window controls to the far right */}
      <div className="flex-1" />

      {/* Windows/Linux: custom window controls (min/max/close) */}
      {showCustomControls && <WindowControls />}
    </header>
  )
})
