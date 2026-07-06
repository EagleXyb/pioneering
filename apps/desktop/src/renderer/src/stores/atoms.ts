// ============================================================
// Jotai Atoms — UI 细粒度状态（面板宽度、显隐等）
// ============================================================

import { atomWithStorage } from 'jotai/utils'
import { atom } from 'jotai'

// 当前运行平台（由主进程经 IPC 返回，渲染端统一读取，避免重复推断）
// 'unknown' 仅作为初始值，App 挂载后即被真实平台覆盖
export type Platform = 'mac' | 'windows' | 'linux' | 'unknown'
export const platformAtom = atom<Platform>('unknown')

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

// 设置弹框开关
export const settingsOpenAtom = atom(false)

// 设置弹框当前分类（持久化）
export const settingsCategoryAtom = atomWithStorage<string>('settings-category', 'api')
