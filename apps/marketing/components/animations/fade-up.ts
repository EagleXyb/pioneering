import type { HTMLMotionProps } from 'framer-motion'

// ============================================================
// fadeUp — 统一的入场动效 props 工厂
//
// 全站卡片/行卡入场动画收敛于此，替代各 section 手写的
// initial/whileInView/viewport/transition 四件套。
// reduced-motion 支持由 <MotionProvider>（MotionConfig reducedMotion="user"）
// 在全局统一处理。
// ============================================================

const EASE = [0.25, 0.46, 0.45, 0.94] as const

export function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-50px' },
    transition: { duration: 0.6, ease: EASE, delay },
  } satisfies HTMLMotionProps<'div'>
}
