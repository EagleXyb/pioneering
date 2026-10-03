// ============================================================
// usePanelToggle — 跨模式统一的侧栏/上下文面板开关
// 三栏模式：驱动 ResizablePanel 的 collapse()/expand()；
// 覆盖模式：仅翻转 atom，由 Drawer 读取开关状态。
// 键盘快捷键等外部修改 atom 时，三栏模式会自动同步折叠态。
// ============================================================

import { useEffect, useRef, useCallback } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { sidebarVisibleAtom, contextPanelVisibleAtom } from '@/stores/atoms'
import { rightPanelMaximizedAtom } from '@/stores/rightPanelStore'
import { useResponsiveLayout } from '@/platform/useResponsiveLayout'

/** 面板最大化时占用的宽度百分比（为中栏保留最小可用宽度） */
const MAXIMIZED_PANEL_SIZE = 85

export function usePanelToggle() {
  const { mode } = useResponsiveLayout()
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)
  const maximized = useAtomValue(rightPanelMaximizedAtom)

  const contextRef = useRef<ImperativePanelHandle>(null)
  /** 最大化前的宽度百分比，用于还原 */
  const sizeBeforeMaximizeRef = useRef<number | null>(null)

  // 同步 atom → 三栏模式的折叠态（覆盖键盘快捷键等外部修改）
  // 注：侧边栏已改为固定 262px 的 flex 元素，其折叠态由 sidebarVisible atom
  //     直接通过 CSS 宽度控制，无需驱动 ResizablePanel。
  useEffect(() => {
    if (mode === 'three-column') {
      contextPanelVisible ? contextRef.current?.expand() : contextRef.current?.collapse()
    }
  }, [contextPanelVisible, mode])

  // 最大化 / 还原：记录原宽度后撑满，还原时回写记录值。
  // 仅三栏模式有效 —— 覆盖模式下右栏是 Drawer，宽度不参与 Panel 分配。
  useEffect(() => {
    if (mode !== 'three-column') return
    const panel = contextRef.current
    if (!panel) return
    if (maximized) {
      sizeBeforeMaximizeRef.current = panel.getSize()
      panel.resize(MAXIMIZED_PANEL_SIZE)
      return
    }
    if (sizeBeforeMaximizeRef.current !== null) {
      panel.resize(sizeBeforeMaximizeRef.current)
      sizeBeforeMaximizeRef.current = null
    }
  }, [maximized, mode])

  // useCallback 稳定引用：作为 TitleBar 的 onToggleContext 等 props，
  // 使其 React.memo 在父级无关重渲染时真正生效（P2-3）
  const toggleSidebar = useCallback(() => setSidebarVisible(!sidebarVisible), [sidebarVisible])
  const toggleContext = useCallback(
    () => setContextPanelVisible(!contextPanelVisible),
    [contextPanelVisible]
  )

  return { contextRef, toggleSidebar, toggleContext, mode }
}
