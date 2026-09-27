'use client'

// ============================================================
// MobileMenu — 全屏移动菜单（≤1000px 时由汉堡键开启）
// 顶层为手风琴：menu 项点击展开子条目与 NEW 推广卡；
// 默认展开当前页所属菜单。底部保留「免费体验」主按钮。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Button } from '@/components/site/ui/Button'
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
} from 'lucide-react'
import {
  BRAND_NAV,
  BRAND_NAV_ABOUT,
  type NavIconKey,
} from '@/data/site/site'
import { CloseIcon } from '@/components/site/ui/Icons'

// 与 SiteNav.ICONS 保持同构（静态映射，避免与 SiteNav 循环依赖）
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

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function MobileMenu({
  open,
  current,
  onClose,
}: {
  open: boolean
  current: string
  onClose: () => void
}) {
  const [expandedHref, setExpandedHref] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const shouldReturnFocusRef = useRef(true)

  const closeWithoutFocusReturn = () => {
    shouldReturnFocusRef.current = false
    onClose()
  }

  useEffect(() => setMounted(true), [])

  // 每次打开时，默认展开当前页所属菜单
  useEffect(() => {
    if (open) {
      const hit = BRAND_NAV.find(
        (n) => n.kind === 'menu' && isActive(current, n.href),
      )
      setExpandedHref(hit ? hit.href : null)
    }
  }, [open, current])

  // 模态菜单：锁定背景滚动、处理 Esc 与 Tab，并在关闭后把焦点还给汉堡键
  useEffect(() => {
    if (!open) return

    shouldReturnFocusRef.current = true
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const previousOverflow = document.body.style.overflow
    const brandRoot = document.querySelector('.brand-site')
    document.body.classList.add('mmenu-on')
    document.body.style.overflow = 'hidden'
    brandRoot?.setAttribute('inert', '')

    const focusFrame = requestAnimationFrame(() => closeRef.current?.focus())

    const getFocusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled])',
        ) ?? [],
      ).filter((element) => element.tabIndex !== -1)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        shouldReturnFocusRef.current = true
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = getFocusable()
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement

      if (event.shiftKey && activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown)
      brandRoot?.removeAttribute('inert')
      document.body.classList.remove('mmenu-on')
      document.body.style.overflow = previousOverflow
      if (shouldReturnFocusRef.current) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => previousFocusRef.current?.focus())
        })
      }
    }
  }, [open, onClose])

  if (!mounted || !open) return null

  const menuPanelId = 'mobile-site-menu'

  // Portal 到 body：header 的 backdrop-filter 会为 fixed 后代建立包含块，
  // 挂在 header 内会把全屏菜单限制在 68px 的 header 高度里
  return createPortal(
    <div
      id={menuPanelId}
      ref={panelRef}
      className="mmenu open"
      role="dialog"
      aria-modal="true"
      aria-label="全站导航"
    >
      <button
        ref={closeRef}
        type="button"
        className="icon-btn mclose"
        aria-label="关闭菜单"
        onClick={() => {
          shouldReturnFocusRef.current = true
          onClose()
        }}
      >
        <CloseIcon />
      </button>

      <div className="mmenu-scroll">
        {BRAND_NAV.map((item) => {
          if (item.kind === 'link') {
            const active = isActive(current, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeWithoutFocusReturn}
                className={`m-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            )
          }

          const expanded = expandedHref === item.href
          const submenuId = `mobile-submenu-${item.href.replace('/', '')}`
          return (
            <div key={item.href} className={`m-group${expanded ? ' open' : ''}`}>
              <button
                type="button"
                className="m-group-head"
                aria-expanded={expanded}
                aria-controls={submenuId}
                onClick={() =>
                  setExpandedHref((cur) => (cur === item.href ? null : item.href))
                }
              >
                <span
                  className={isActive(current, item.href) ? 'active' : undefined}
                  aria-current={isActive(current, item.href) ? 'true' : undefined}
                >
                  {item.label}
                </span>
                <ChevronDown size={18} className="m-caret" strokeWidth={2.2} />
              </button>

              {expanded && (
                <div id={submenuId} className="m-sub" role="group">
                  {item.children.map((child) => {
                    const Icon = ICONS[child.icon]
                    return (
                      <Link
                        key={child.title}
                        href={child.href}
                        onClick={closeWithoutFocusReturn}
                        className="m-sub-item"
                      >
                        <span className="m-sub-icon">
                          <Icon size={18} strokeWidth={1.8} />
                        </span>
                        <span className="m-sub-text">
                          <strong>{child.title}</strong>
                          <span>{child.desc}</span>
                        </span>
                      </Link>
                    )
                  })}

                  {item.promo && (
                    <div className="m-promo">
                      <span className="mega-badge">{item.promo.badge}</span>
                      <strong>{item.promo.title}</strong>
                      <p>{item.promo.desc}</p>
                      <Link href={item.promo.href} className="mega-cta" onClick={closeWithoutFocusReturn}>
                        {item.promo.cta}
                        <ArrowRight size={15} strokeWidth={2.2} />
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        <Link
          href={BRAND_NAV_ABOUT.href}
          onClick={closeWithoutFocusReturn}
          className={`m-item${isActive(current, BRAND_NAV_ABOUT.href) ? ' active' : ''}`}
          aria-current={isActive(current, BRAND_NAV_ABOUT.href) ? 'page' : undefined}
        >
          {BRAND_NAV_ABOUT.label}
        </Link>
      </div>

      <Button href="/agent#try" variant="primary" className="m-cta" onClick={closeWithoutFocusReturn}>
        免费体验
      </Button>
    </div>,
    document.body,
  )
}
