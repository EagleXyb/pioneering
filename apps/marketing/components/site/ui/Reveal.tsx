'use client'

// ============================================================
// Reveal — 对应原型 .reveal + IntersectionObserver 入场
// 效果：opacity 0 → 1、translateY(12px) → 0、0.4s；
// 仅播放一次（threshold .12）。
// 用户系统开启"减少动态效果"时直出静态内容（对应原型
// @media (prefers-reduced-motion: reduce) { .reveal { opacity:1 } }）。
// ============================================================

import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * 减少动画偏好（水合安全版）：
 * 服务端无 matchMedia，framer-motion 的 useReducedMotion 在 SSR 恒为 false、
 * 客户端首帧却同步读到系统设置——两边 DOM 不一致会触发 hydration mismatch。
 * 这里首帧（服务端与客户端）恒为 false，挂载后经 effect 再读取并切换。
 */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduce(mql.matches)
    sync()
    mql.addEventListener?.('change', sync)
    return () => mql.removeEventListener?.('change', sync)
  }, [])

  return reduce
}

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const reduce = usePrefersReducedMotion()

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
