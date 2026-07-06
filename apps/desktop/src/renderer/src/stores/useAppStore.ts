// ============================================================
// App Store — 全局应用状态 (Zustand)
// ============================================================

import { create } from 'zustand'

export type WorkMode = 'work' | 'code' | 'design'
export type SidebarTab =
  | 'files'
  | 'search'
  | 'git'
  | 'tools'
  | 'skills'
  | 'history'
  | 'assets'
  | 'chat'
  | 'folder'

interface AppState {
  // 布局可见性
  sidebarVisible: boolean
  chatPanelVisible: boolean
  bottomPanelVisible: boolean

  // 模式 & 标签
  activeMode: WorkMode
  activeSidebarTab: SidebarTab

  // 侧边栏宽度记录 (用于 toggle 恢复)
  _sidebarWidth: number

  // Actions
  toggleSidebar: () => void
  toggleChatPanel: () => void
  toggleBottomPanel: () => void
  setActiveMode: (mode: WorkMode) => void
  setActiveSidebarTab: (tab: SidebarTab) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarVisible: true,
  chatPanelVisible: true,
  bottomPanelVisible: false,
  activeMode: 'work',
  activeSidebarTab: 'files',
  _sidebarWidth: 260,

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleChatPanel: () => set((s) => ({ chatPanelVisible: !s.chatPanelVisible })),
  toggleBottomPanel: () => set((s) => ({ bottomPanelVisible: !s.bottomPanelVisible })),
  setActiveMode: (mode) => set({ activeMode: mode }),
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab, sidebarVisible: true })
}))
