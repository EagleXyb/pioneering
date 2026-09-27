'use client'

// ============================================================
// SiteNav — 全站 sticky 导航（mega dropdown 版）
// 桌面端：pill 触发器 + 大面板（功能条目 + 右侧 NEW 推广卡），
// hover 展开、click 切换、Esc / 外部点击 / X 关闭；
// 滚动加细线；≤1000px 收纳为汉堡键，手风琴面板见 MobileMenu。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/site/ui/Button'
import { AnimatePresence, motion } from 'framer-motion'
import {
  LayoutGrid,
  MessagesSquare,
  Sparkles,
  Network,
  Boxes,
  CreditCard,
  FlaskConical,
  Compass,
  BookOpen,
  ChevronDown,
  ArrowRight,
  X,
} from 'lucide-react'
import {
  BRAND_NAV,
  BRAND_NAV_ABOUT,
  type BrandNavItem,
  type NavIconKey,
} from '@/data/site/site'
import { Logo } from '@/components/site/ui/Logo'
import { BurgerIcon } from '@/components/site/ui/Icons'
import { MobileMenu } from './MobileMenu'

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** NavIconKey → lucide 图标 */
const ICONS: Record<NavIconKey, typeof LayoutGrid> = {
  grid: LayoutGrid,
  chat: MessagesSquare,
  sparkles: Sparkles,
  model: Network,
  pillar: Boxes,
  cards: CreditCard,
  science: FlaskConical,
  method: Compass,
  topics: BookOpen,
}

const HOVER_CLOSE_DELAY = 140

export function SiteNav() {
  const pathname = usePathname()
  const rootRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [openHref, setOpenHref] = useState<string | null>(null)

  const canHover = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const closeMobileMenu = useCallback(() => setMenuOpen(false), [])

  // 滚动加细线
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 路由切换后收起面板
  useEffect(() => {
    setOpenHref(null)
  }, [pathname])

  // 设备旋转 / iPad 分屏进入移动档时，关闭仅桌面端使用的 Mega 面板
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1000px)')
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpenHref(null)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Esc 关闭 + 外部点击关闭；Esc 后焦点返回对应触发器
  useEffect(() => {
    if (!openHref) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const href = openHref
        setOpenHref(null)
        requestAnimationFrame(() => triggerRefs.current[href]?.focus())
      }
    }
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setOpenHref(null)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDocClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDocClick)
    }
  }, [openHref])

  const cancelHoverClose = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }

  const openWithHover = (href: string) => {
    cancelHoverClose()
    setOpenHref(href)
  }

  const scheduleHoverClose = () => {
    cancelHoverClose()
    hoverTimer.current = setTimeout(() => setOpenHref(null), HOVER_CLOSE_DELAY)
  }

  const activeItem: BrandNavItem | undefined =
    openHref != null
      ? BRAND_NAV.find((n) => n.kind === 'menu' && n.href === openHref)
      : undefined

  // Portal 容器：.brand-site（在 header 外，脱离 header 的 backdrop root；
  // 同时保留 .brand-site 样式作用域），兜底 body
  const portalContainer =
    typeof document !== 'undefined'
      ? document.querySelector('.brand-site') ?? document.body
      : null

  return (
    <header
      ref={rootRef}
      className={`nav${scrolled ? ' scrolled' : ''}${openHref ? ' is-open' : ''}`}
      onMouseEnter={() => {
        if (canHover()) cancelHoverClose()
      }}
      onMouseLeave={() => {
        if (canHover()) scheduleHoverClose()
      }}
    >
      <div className="wrap nav-in">
        <Logo />

        <nav className="nav-links" aria-label="主导航">
          {BRAND_NAV.map((item) => {
            const current = isActive(pathname, item.href)
            if (item.kind === 'link') {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link${current ? ' active' : ''}`}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => setOpenHref(null)}
                >
                  {item.label}
                </Link>
              )
            }
            const expanded = openHref === item.href
            return (
              <button
                key={item.href}
                ref={(node) => {
                  triggerRefs.current[item.href] = node
                }}
                type="button"
                className={`nav-trigger${expanded ? ' expanded' : ''}${
                  current ? ' active' : ''
                }`}
                aria-haspopup="true"
                aria-expanded={expanded}
                aria-controls={`mega-${item.href.replace('/', '')}`}
                aria-current={current ? 'true' : undefined}
                onMouseEnter={() => {
                  if (canHover()) openWithHover(item.href)
                }}
                onClick={() =>
                  setOpenHref((cur) => (cur === item.href ? null : item.href))
                }
              >
                {item.label}
                <ChevronDown
                  size={15}
                  className="nav-caret"
                  strokeWidth={2.2}
                />
              </button>
            )
          })}
        </nav>

        <div className="nav-right">
          <Link
            href={BRAND_NAV_ABOUT.href}
            className="nav-login"
            aria-current={isActive(pathname, BRAND_NAV_ABOUT.href) ? 'page' : undefined}
          >
            {BRAND_NAV_ABOUT.label}
          </Link>
          <Button href="/agent#try" variant="primary" size="sm">
            免费体验
          </Button>
          <button
            type="button"
            className="icon-btn nav-close"
            aria-label="关闭菜单"
            tabIndex={openHref ? 0 : -1}
            onClick={() => {
              const href = openHref
              setOpenHref(null)
              if (href) requestAnimationFrame(() => triggerRefs.current[href]?.focus())
            }}
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        </div>

        <button
          type="button"
          className="icon-btn burger"
          aria-label="打开菜单"
          aria-expanded={menuOpen}
          aria-controls="mobile-site-menu"
          onClick={(event) => {
            event.currentTarget.focus()
            setMenuOpen(true)
          }}
        >
          <BurgerIcon />
        </button>
      </div>

      {/* Mega dropdown 大面板：portal 到 header 外（header 的 backdrop-filter 会形成
          backdrop root，面板挂在 header 内时自身的 backdrop-filter 无法模糊页面内容） */}
      {portalContainer &&
        createPortal(
          <AnimatePresence>
            {activeItem && activeItem.kind === 'menu' && (
              <motion.div
                key={activeItem.href}
                ref={panelRef}
                id={`mega-${activeItem.href.replace('/', '')}`}
                className="mega"
                role="region"
                aria-label={`${activeItem.label}菜单`}
                onMouseEnter={() => {
                  if (canHover()) cancelHoverClose()
                }}
                onMouseLeave={() => {
                  if (canHover()) scheduleHoverClose()
                }}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <div className="wrap mega-in">
                  <div className="mega-items">
                    {activeItem.children.map((child) => {
                      const Icon = ICONS[child.icon]
                      return (
                        <Link
                          key={child.title}
                          href={child.href}
                          className="mega-item"
                          onClick={() => setOpenHref(null)}
                        >
                          <span className="mega-icon">
                            <Icon size={20} strokeWidth={1.8} />
                          </span>
                          <span className="mega-text">
                            <strong>{child.title}</strong>
                            <span>{child.desc}</span>
                          </span>
                        </Link>
                      )
                    })}
                  </div>

                  {activeItem.promo && (
                    <aside className="mega-promo">
                      <span className="mega-badge">{activeItem.promo.badge}</span>
                      <strong>{activeItem.promo.title}</strong>
                      <p>{activeItem.promo.desc}</p>
                      <Link
                        href={activeItem.promo.href}
                        className="mega-cta"
                        onClick={() => setOpenHref(null)}
                      >
                        {activeItem.promo.cta}
                        <ArrowRight size={15} strokeWidth={2.2} />
                      </Link>
                    </aside>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          portalContainer,
        )}

      <MobileMenu open={menuOpen} current={pathname} onClose={closeMobileMenu} />
    </header>
  )
}
