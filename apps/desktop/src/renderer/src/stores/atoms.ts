// ============================================================
// Jotai Atoms — UI 细粒度状态（面板宽度、显隐等）
// ============================================================

import { atomWithStorage } from 'jotai/utils'
import { atom } from 'jotai'

// 平台类型与归一化函数统一从 shared 引入，主进程/渲染端共用，避免两处各写一份
import type { Platform } from '@shared/types'
export type { Platform }
export const platformAtom = atom<Platform>('unknown')

// 窗口全屏态（macOS 全屏 / Windows F11 等），由主进程经 IPC 推送
export const isFullscreenAtom = atom(false)

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
export const themeAtom = atomWithStorage<string>('theme', 'light')

// 设置弹框开关
export const settingsOpenAtom = atom(false)

// 当前用户信息（占位，后续可由 IPC/登录态填充）
export const userAtom = atom<{ name: string; email: string; avatarUrl: string }>({
  name: 'Demo User',
  email: 'demo@pioneering.ai',
  avatarUrl: ''
})

// 设置弹框当前分类（持久化）
export const settingsCategoryAtom = atomWithStorage<string>('settings-category', 'api')
