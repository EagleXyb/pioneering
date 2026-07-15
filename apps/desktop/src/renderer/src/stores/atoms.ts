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

// 面板显隐
export const sidebarVisibleAtom = atom(true)
export const contextPanelVisibleAtom = atom(false)

// 设置弹框开关
export const settingsOpenAtom = atom(false)

// 当前用户信息（启动时由 IPC 注入 / 登录态填充）
export interface AppUser {
  id: string
  username: string
  nickname: string | null
  email: string | null
  avatar: string | null
}
export const userAtom = atom<AppUser>({
  id: '',
  username: '未登录',
  nickname: null,
  email: null,
  avatar: null
})

// 设置弹框当前分类（持久化）
export const settingsCategoryAtom = atomWithStorage<string>('settings-category', 'api')
