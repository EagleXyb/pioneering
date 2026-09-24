'use client'

// ============================================================
// SiteNav — 全站 sticky 导航：滚动加细线、当前页下划线、
// 搜索占位图标、「免费体验」CTA、汉堡键（≤1000px）
// ============================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BRAND_NAV } from '@/data/site/site'
import { Logo } from '@/components/site/ui/Logo'
import { SearchIcon, BurgerIcon } from '@/components/site/ui/Icons'
import { MobileMenu } from './MobileMenu'

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SiteNav() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`nav${scrolled ? ' scrolled' : ''}`}>
      <div className="wrap nav-in">
        <Logo />
        <nav className="nav-links" aria-label="主导航">
          {BRAND_NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={isActive(pathname, n.href) ? 'active' : undefined}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="nav-right">
          <button type="button" className="icon-btn" aria-label="搜索（二期开放）">
            <SearchIcon />
          </button>
          <Link href="/agent#try" className="btn btn-primary btn-sm">
            免费体验
          </Link>
        </div>
        <button
          type="button"
          className="icon-btn burger"
          aria-label="打开菜单"
          onClick={() => setMenuOpen(true)}
        >
          <BurgerIcon />
        </button>
      </div>
      <MobileMenu open={menuOpen} current={pathname} onClose={() => setMenuOpen(false)} />
    </header>
  )
}
