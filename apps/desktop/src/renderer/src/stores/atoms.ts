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

// 当前用户信息的结构。
// 认证态（status / user / 缓存）统一由 stores/authStore.ts 管理，
// 此处仅保留类型定义供各处复用。
export interface AppUser {
  id: string
  username: string
  nickname: string | null
  email: string | null
  avatar: string | null
}

// 设置弹框当前分类（持久化）
export const settingsCategoryAtom = atomWithStorage<string>('settings-category', 'api')

// 中栏消息区是否滚动离开顶部：ChatHeader 据此决定是否显示下边框
export const chatScrolledAtom = atom(false)

// 聊天区是否处于欢迎页模式（空会话、输入框居中、顶部栏隐藏）
// ChatArea 设置此状态，RootLayout/ChatHeader 据此控制顶部栏显隐
export const chatWelcomeModeAtom = atom(false)

// ============================================================
// 通用确认弹层（删除会话等破坏性操作）
// ============================================================
// 说明：
//   - 业务层调用 openConfirmDialog(payload) 触发；
//   - ConfirmDialog 单例订阅 confirmDialogStateAtom，确认后执行 payload.onConfirm；
//   - 样式对齐截图：⚠ 警告图标 + 圆角 12px + 红底确认按钮。
//
// jotai 版本兼容：用双参数显式 setter atom（atom(init, (_get,set,arg)=>...)）
// 带 write 签名，避免当前版本下 `atom(v)` 被误判为只读 Atom<...> 的问题
// （与 lightboxStore.ts 的 openLightboxAtom / closeLightboxAtom 同构）。
export interface ConfirmDialogPayload {
  id: string
  title: string
  description: string
  confirmText: string
  cancelText?: string
  confirmVariant?: 'destructive' | 'default'
  icon?: 'warning' | 'info' | 'danger'
  onConfirm: () => void | Promise<void>
}

export const confirmDialogStateAtom = atom<ConfirmDialogPayload | null>(null)

/** 打开确认弹窗（写入 payload；null 关闭） */
export const openConfirmDialogAtom = atom(
  null,
  (_get, set, payload: ConfirmDialogPayload | null) => {
    set(confirmDialogStateAtom, payload)
  }
)
