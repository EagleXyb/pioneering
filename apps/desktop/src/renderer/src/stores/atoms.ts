// ============================================================
// Jotai Atoms — UI 细粒度状态（面板宽度、显隐等）
// ============================================================

import { atomWithStorage } from 'jotai/utils'
import { atom } from 'jotai'

// 面板宽度 (持久化到 localStorage)
export const sidebarWidthAtom = atomWithStorage('sidebar-width', 15)
export const contextPanelWidthAtom = atomWithStorage('context-width', 30)

// 面板显隐
export const sidebarVisibleAtom = atom(true)
export const contextPanelVisibleAtom = atom(true)

// 侧边栏当前标签页
export const sidebarTabAtom = atom<string>('conversations')

// 上下文面板当前标签页
export const contextPanelTabAtom = atom<string>('code')

// 主题模式
export const themeAtom = atomWithStorage<string>('theme', 'dark')
