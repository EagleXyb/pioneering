'use client'

// ============================================================
// MobileCTA — 移动端（≤768px）底部「免费体验」条
// 行为对齐原型：下滑超过 200px 隐藏，上滑/回顶出现。
// /agent 页按原型不出现。
// ============================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function MobileCTA() {
  const pathname = usePathname()
  const [show, setShow] = useState(false)

  useEffect(() => {
    let lastY = 0
    const onScroll = () => {
      const y = window.scrollY
      if (y > lastY && y > 200) {
        setShow(false)
      } else {
        setShow(true)
      }
      lastY = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (pathname === '/agent' || pathname.startsWith('/agent/')) return null

  return (
    <Link href="/agent#try" className={`mcta${show ? ' show' : ''}`}>
      免费体验智能体 →
    </Link>
  )
}
