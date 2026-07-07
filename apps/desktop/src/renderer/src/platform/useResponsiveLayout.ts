// ============================================================
// useResponsiveLayout — 响应式布局模式
// 根据窗口宽度（BrowserWindow 内容宽度）决定三栏 inline 还是覆盖抽屉，
// 断点随平台微调：无原生边框的 Win/Linux 在更宽处才退化为覆盖布局。
// ============================================================

import { useState, useEffect } from 'react'
import { usePlatform } from '@/hooks/usePlatform'

export type LayoutMode = 'three-column' | 'overlay'

export function useResponsiveLayout() {
  const { platform } = usePlatform()
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    let rafId: number | null = null
    const onResize = () => {
      // 用 rAF 合并高频 resize 事件，避免拖拽窗口时整树频繁重渲染
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        setWidth(window.innerWidth)
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  // 断点随平台微调
  const breakpoint = platform === 'mac' ? 980 : 1080
  const mode: LayoutMode = width < breakpoint ? 'overlay' : 'three-column'

  return { mode, width }
}
