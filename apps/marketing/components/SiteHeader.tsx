'use client'

// ============================================================
// SiteHeader — 统一顶部导航（官网 / 趋势报告共用）
//
// - sticky 材料顶栏 + 底部分隔线，桌面端行内锚链导航
// - 移动端（< md）收纳为汉堡菜单，点击展开下拉面板
// - 所有主要触控目标不小于 44px
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'

export interface SiteNavLink {
  href: string
  label: string
}

interface SiteHeaderProps {
  /** 左侧品牌区（logo + 文案等） */
  left: React.ReactNode
  /** 桌面端 + 移动菜单共用的导航项 */
  nav: readonly SiteNavLink[]
}

export function SiteHeader({ left, nav }: SiteHeaderProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  const linkClass =
    'text-sm text-text-muted no-underline transition-colors duration-200 hover:text-text-primary'

  return (
    <header
      ref={rootRef}
      className="trends-nav sticky top-0 z-50 w-full flex justify-between items-center min-h-[72px]"
    >
      <div className="flex items-center gap-5 min-w-0">{left}</div>

      {/* 桌面端导航 */}
      <nav className="hidden md:flex items-center gap-8" aria-label="趋势报告导航">
        {nav.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`${linkClass} inline-flex min-h-11 items-center px-2 rounded-lg active:bg-white/10`}
          >
            {item.label}
          </a>
        ))}
      </nav>

      {/* 移动端汉堡按钮 */}
      <button
        type="button"
        className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg text-text-muted hover:text-text-primary active:bg-white/10 transition-colors"
        aria-label={open ? '关闭菜单' : '打开菜单'}
        aria-expanded={open}
        aria-controls="trends-mobile-nav"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* 移动端下拉菜单 */}
      {open && (
        <nav
          id="trends-mobile-nav"
          className="trends-mobile-nav md:hidden absolute left-0 right-0 top-full flex flex-col border-b border-divider bg-bg"
          aria-label="趋势报告移动导航"
        >
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="min-h-11 flex items-center px-5 text-sm text-text-muted no-underline border-t border-divider transition-colors duration-200 hover:text-text-primary active:bg-white/10"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  )
}
