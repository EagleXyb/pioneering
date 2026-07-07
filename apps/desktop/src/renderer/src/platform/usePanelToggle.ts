// ============================================================
// usePanelToggle — 跨模式统一的侧栏/上下文面板开关
// 三栏模式：驱动 ResizablePanel 的 collapse()/expand()；
// 覆盖模式：仅翻转 atom，由 Drawer 读取开关状态。
// 键盘快捷键等外部修改 atom 时，三栏模式会自动同步折叠态。
// ============================================================

import { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { sidebarVisibleAtom, contextPanelVisibleAtom } from '@/stores/atoms'
import { useResponsiveLayout } from '@/platform/useResponsiveLayout'

export function usePanelToggle() {
  const { mode } = useResponsiveLayout()
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const [contextPanelVisible, setContextPanelVisible] = useAtom(contextPanelVisibleAtom)

  const sidebarRef = useRef<ImperativePanelHandle>(null)
  const contextRef = useRef<ImperativePanelHandle>(null)

  // 同步 atom → 三栏模式的折叠态（覆盖键盘快捷键等外部修改）
  useEffect(() => {
    if (mode === 'three-column') {
      sidebarVisible ? sidebarRef.current?.expand() : sidebarRef.current?.collapse()
    }
  }, [sidebarVisible, mode])

  useEffect(() => {
    if (mode === 'three-column') {
      contextPanelVisible ? contextRef.current?.expand() : contextRef.current?.collapse()
    }
  }, [contextPanelVisible, mode])

  const toggleSidebar = () => setSidebarVisible(!sidebarVisible)
  const toggleContext = () => setContextPanelVisible(!contextPanelVisible)

  return { sidebarRef, contextRef, toggleSidebar, toggleContext, mode }
}
