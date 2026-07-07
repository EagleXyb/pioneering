// ============================================================
// Drawer — 轻量覆盖抽屉（覆盖模式下承载 Sidebar / ContextPanel）
// 不引入额外依赖，使用固定定位 + transform 过渡实现滑入滑出。
// ============================================================

import { useEffect } from 'react'
import { cn } from '@/lib/utils'

interface DrawerProps {
  open: boolean
  side: 'left' | 'right'
  onClose: () => void
  width?: number
  className?: string
  children: React.ReactNode
}

export function Drawer({ open, side, onClose, width = 320, className, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden
      />
      {/* 面板：自标题栏下沿开始，避免遮挡原生控件 */}
      <aside
        className={cn(
          'fixed bottom-0 z-50 shadow-xl transition-transform duration-200 ease-out',
          side === 'left' ? 'left-0' : 'right-0',
          open
            ? 'translate-x-0'
            : side === 'left'
              ? '-translate-x-full'
              : 'translate-x-full',
          className
        )}
        style={{ top: 'var(--titlebar-h)', width }}
      >
        {children}
      </aside>
    </>
  )
}
