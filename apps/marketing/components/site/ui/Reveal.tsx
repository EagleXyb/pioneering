'use client'

// ============================================================
// Reveal — 对应原型 .reveal + IntersectionObserver 入场
// 效果：opacity 0 → 1、translateY(12px) → 0、0.4s；
// 仅播放一次（threshold .12）。
// 用户系统开启"减少动态效果"时直出静态内容（对应原型
// @media (prefers-reduced-motion: reduce) { .reveal { opacity:1 } }）。
// ============================================================

import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const reduce = useReducedMotion()

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.4, ease: 'easeOut', delay }}
    >
      {children}
    </motion.div>
  )
}
