// ============================================================
// Card — 统一卡片容器（样式零变化，收敛 .card* 变体）
//
// - default：纸色填底卡（.card）
// - hover：可上浮卡（.card.card-hover）
// - flat：无框透明轻容器（.card-flat，P1 去卡片化试点）
// - link：透明白卡，hover 轻底色 + 标题变青瓷（.card.card-link）
// - quiet：静默卡（.card.card-quiet）
// - 传 href 时整卡可点：站内路径渲染 next/link，# 锚点或外链渲染 <a>
// ============================================================

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

type CardVariant = 'default' | 'hover' | 'flat' | 'link' | 'quiet'

const CLASS_MAP: Record<CardVariant, string> = {
  default: 'card',
  hover: 'card card-hover',
  flat: 'card-flat',
  link: 'card card-link',
  quiet: 'card card-quiet',
}

interface CardProps {
  variant?: CardVariant
  href?: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}

export function Card({
  variant = 'default',
  href,
  className = '',
  style,
  children,
}: CardProps) {
  const cls = [CLASS_MAP[variant], className].filter(Boolean).join(' ')

  if (href) {
    if (href.startsWith('#') || /^https?:\/\//.test(href)) {
      return (
        <a href={href} className={cls} style={style}>
          {children}
        </a>
      )
    }
    return (
      <Link href={href} className={cls} style={style}>
        {children}
      </Link>
    )
  }

  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}
