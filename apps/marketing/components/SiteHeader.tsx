'use client'

// ============================================================
// SiteHeader — 统一顶部导航（官网 / 趋势报告共用）
//
// 替代原先 OfficialHeader / Header 两套重复实现：
// - 72px 高 + 底部分隔线，桌面端行内锚链导航
// - 移动端（< md）收纳为汉堡菜单，点击展开下拉面板，
//   解决原先导航溢出破版的问题
// - left / nav 由调用方注入，视觉行为统一在这里维护
// ============================================================

import { useState } from 'react'
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

  const linkClass =
    'text-sm text-text-muted no-underline transition-colors duration-200 hover:text-text-primary'

  return (
    <>
      <header className="w-full flex justify-between items-center h-[72px] px-5 md:px-12 bg-bg">
        <div className="flex items-center gap-5 min-w-0">{left}</div>

        {/* 桌面端导航 */}
        <nav className="hidden md:flex items-center gap-8">
          {nav.map((item) => (
            <a key={item.href} href={item.href} className={linkClass}>
              {item.label}
            </a>
          ))}
        </nav>

        {/* 移动端汉堡按钮 */}
        <button
          type="button"
          className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-muted hover:text-text-primary transition-colors"
          aria-label={open ? '关闭菜单' : '打开菜单'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {/* 移动端下拉菜单 */}
      {open && (
        <nav className="md:hidden w-full flex flex-col border-b border-divider bg-bg">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="px-5 py-3.5 text-sm text-text-muted no-underline border-t border-divider transition-colors duration-200 hover:text-text-primary"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}

      <div className="w-full h-px bg-divider" />
    </>
  )
}
