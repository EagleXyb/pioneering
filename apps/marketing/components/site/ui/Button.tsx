// ============================================================
// Button — 统一按钮入口（样式零变化，收敛 .btn-* 组合）
//
// - 传 href：站内路径渲染 next/link；# 锚点或 http(s) 外链渲染 <a>
// - 不传 href：渲染 <button>，默认 type="button"（避免误提交）
// - variant：primary（青瓷实心）/ ink（深墨实心）/ ghost（描边）
// - size：md（默认）/ sm
// ============================================================

import Link from 'next/link'
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  MouseEventHandler,
  ReactNode,
} from 'react'

type Variant = 'primary' | 'ink' | 'ghost'
type Size = 'md' | 'sm'

interface ButtonProps {
  href?: string
  variant?: Variant
  size?: Size
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLElement>
  className?: string
  style?: CSSProperties
  children: ReactNode
}

export function Button({
  href,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled,
  onClick,
  className = '',
  style,
  children,
}: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', className]
    .filter(Boolean)
    .join(' ')

  if (href) {
    // 锚点与外链保持原生 <a>，避免客户端导航改变既有行为
    if (href.startsWith('#') || /^https?:\/\//.test(href)) {
      return (
        <a href={href} className={cls} style={style} onClick={onClick}>
          {children}
        </a>
      )
    }
    return (
      <Link href={href} className={cls} style={style} onClick={onClick}>
        {children}
      </Link>
    )
  }

  return (
    <button
      type={type}
      className={cls}
      style={style}
      disabled={disabled}
      onClick={onClick as ButtonHTMLAttributes<HTMLButtonElement>['onClick']}
    >
      {children}
    </button>
  )
}
