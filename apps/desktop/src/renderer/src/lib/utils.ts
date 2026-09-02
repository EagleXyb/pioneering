import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ================================================================
// 字号帮助：把「以 medium=14px 为基准」的设计像素换算成 rem。
//   原因：设置弹框通过 Radix DialogPortal 挂到 body 下的独立容器，
//   不会继承 html { font-size }；为了让「字体大小」档位在弹框内部
//   也能按比例缩放，所有硬编码 px 字号（如 13/14/12/22px）要先写成
//   "以 14px 为 1rem" 的等效 rem 值。
//   档位切换后，当前上下文（html 或 弹壳）把 1rem 重新绑定到
//   13/14/16px，文本就会自动按比例缩放。
// ================================================================
const MEDIUM_PX_BASE = 14
/** px(设计稿像素) → rem（相对 14px=1rem 的基准） */
export function pxToRem(px: number): string {
  if (px === MEDIUM_PX_BASE) return '1rem'
  return `${+(px / MEDIUM_PX_BASE).toFixed(6)}rem`
}
