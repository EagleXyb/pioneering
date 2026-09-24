'use client'

import Link from 'next/link'
import { BRAND_NAV } from '@/data/site/site'
import { CloseIcon } from '@/components/site/ui/Icons'

// ============================================================
// MobileMenu — 全屏移动菜单（≤1000px 时由汉堡键开启）
// ============================================================

export function MobileMenu({
  open,
  current,
  onClose,
}: {
  open: boolean
  current: string
  onClose: () => void
}) {
  return (
    <div className={`mmenu${open ? ' open' : ''}`} aria-hidden={!open}>
      <button type="button" className="icon-btn mclose" aria-label="关闭菜单" onClick={onClose}>
        <CloseIcon />
      </button>
      {BRAND_NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={onClose}
          className={current === n.href ? 'active' : undefined}
        >
          {n.label}
        </Link>
      ))}
      <Link href="/agent#try" className="btn btn-primary" onClick={onClose}>
        免费体验
      </Link>
    </div>
  )
}
