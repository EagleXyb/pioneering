'use client'

// ============================================================
// MobileMenu — 全屏移动菜单（≤1000px 时由汉堡键开启）
// 顶层为手风琴：menu 项点击展开子条目与 NEW 推广卡；
// 默认展开当前页所属菜单。底部保留「免费体验」主按钮。
// ============================================================

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
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

  // 打开期间隐藏页面悬浮元素（fab / mcta），避免遮挡全屏菜单
  useEffect(() => {
    if (!open) return
    document.body.classList.add('mmenu-on')
    return () => document.body.classList.remove('mmenu-on')
  }, [open])

  if (!mounted) return null

  // Portal 到 body：header 的 backdrop-filter 会为 fixed 后代建立包含块，
  // 挂在 header 内会把全屏菜单限制在 68px 的 header 高度里
  return createPortal(
    <div className={`mmenu${open ? ' open' : ''}`} aria-hidden={!open}>
      <button type="button" className="icon-btn mclose" aria-label="关闭菜单" onClick={onClose}>
        <CloseIcon />
      </button>

      <div className="mmenu-scroll">
        {BRAND_NAV.map((item) => {
          if (item.kind === 'link') {
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`m-item${isActive(current, item.href) ? ' active' : ''}`}
              >
                {item.label}
              </Link>
            )
          }

          const expanded = expandedHref === item.href
          return (
            <div key={item.href} className={`m-group${expanded ? ' open' : ''}`}>
              <button
                type="button"
                className="m-group-head"
                aria-expanded={expanded}
                onClick={() =>
                  setExpandedHref((cur) => (cur === item.href ? null : item.href))
                }
              >
                <span className={isActive(current, item.href) ? 'active' : undefined}>
                  {item.label}
                </span>
                <ChevronDown size={18} className="m-caret" strokeWidth={2.2} />
              </button>

              {expanded && (
                <div className="m-sub">
                  {item.children.map((child) => {
                    const Icon = ICONS[child.icon]
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onClose}
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
                      <Link href={item.promo.href} className="mega-cta" onClick={onClose}>
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
          onClick={onClose}
          className={`m-item${isActive(current, BRAND_NAV_ABOUT.href) ? ' active' : ''}`}
        >
          {BRAND_NAV_ABOUT.label}
        </Link>
      </div>

      <Link href="/agent#try" className="btn btn-primary m-cta" onClick={onClose}>
        免费体验
      </Link>
    </div>,
    document.body,
  )
}
