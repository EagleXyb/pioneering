// ============================================================
// App Store — 全局应用状态 (Zustand) — 精简版
// ============================================================
// 注：UI 细粒度状态（面板宽度、侧边栏标签等）已移至 stores/atoms.ts (Jotai)
// ============================================================

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark' | 'system'

interface AppState {
  /** 主题模式 */
  theme: ThemeMode

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

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'light',

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
    }),
    {
      name: 'pioneering-app',
      partialize: (state) => ({ theme: state.theme })
    }
  )
)
