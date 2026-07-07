// ============================================================
// App Store — 全局应用状态 (Zustand) — 精简版
// ============================================================
// 注：UI 细粒度状态（面板宽度、侧边栏标签等）已移至 stores/atoms.ts (Jotai)
// ============================================================

import { create } from 'zustand'

export type WorkMode = 'work' | 'code' | 'design'

export type ThemeMode = 'light' | 'dark' | 'system'

interface AppState {
  /** 当前工作模式 */
  activeMode: WorkMode
  /** 主题模式 */
  theme: ThemeMode

  setActiveMode: (mode: WorkMode) => void
  setTheme: (theme: ThemeMode) => void
  initTheme: () => void
}

function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme
  root.classList.toggle('dark', resolved === 'dark')
  root.setAttribute('data-theme', resolved)
}

export const useAppStore = create<AppState>((set) => ({
  activeMode: 'work',
  theme: 'light',

  setActiveMode: (mode) => set({ activeMode: mode }),
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  initTheme: () => {
    set((s) => {
      applyTheme(s.theme)
      return s
    })
  }
}))
