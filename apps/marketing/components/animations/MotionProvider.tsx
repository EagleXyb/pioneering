'use client'

import { MotionConfig } from 'framer-motion'
import type { ReactNode } from 'react'

// ============================================================
// MotionProvider — 全局动效包装
//
// reducedMotion="user"：系统开启「减少动态效果」时，
// 所有 framer-motion 动画自动降级为无位移的透明度过渡。
// ============================================================

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
