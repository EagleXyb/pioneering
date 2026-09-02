// ============================================================
// App Store — 全局应用状态 (Zustand) — 精简版
// ============================================================
// 注：UI 细粒度状态（面板宽度、侧边栏标签等）已移至 stores/atoms.ts (Jotai)
// ============================================================

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { HotkeyOverrides } from '../../../shared/hotkey-protocol'

export type ThemeMode = 'light' | 'dark' | 'system'

/** 界面语言（通用 · 基础设置 / 语言切换） */
export type Language = 'zh-CN' | 'zh-TW' | 'en-US'

/** 界面字体大小（通用 · 基础设置 / 字体大小）
 *  - small  ≈ 13px（紧凑型）
 *  - medium ≈ 14px（默认）
 *  - large  ≈ 16px（舒适型） */
export type FontSizeMode = 'small' | 'medium' | 'large'
export const FONT_SIZE_PX: Record<FontSizeMode, number> = {
  small: 13,
  medium: 14,
  large: 16
}

// ---- 模型配置相关类型 ----
export interface ModelConfigItem {
  /** 稳定唯一 ID，供输入框选择和会话引用 */
  id: string
  /** 展示名（如 glm-5.2） */
  name: string
  /** 服务商（如 DeepSeek / Bigmodel / MiniMax-cn / 自定义(OpenAI Compatible)） */
  provider: string
  /** 图标 key（与左侧列表图标对应：openai-compat / deepseek / glm / kimi / minimax 等） */
  iconKey: string
  /** 是否启用：输入框可选；关闭则仍在管理页可见但从下拉列表隐藏 */
  enabled: boolean
  /** 实际发送到后端的模型标识（可与 name 不一致） */
  value?: string
  /** 自定义 API Base（可选；OpenAI Compatible 模式必填） */
  apiBase?: string
  /** API Key（可选；未填时走后端默认） */
  apiKey?: string
}

interface AppState {
  /** 主题模式 */
  theme: ThemeMode
  /** 界面语言（通用 · 基础设置 / 语言切换） */
  language: Language
  /** 界面字体大小（通用 · 基础设置 / 字体大小） */
  fontSize: FontSizeMode

  /**
   * 快捷键覆盖表（只读缓存！electron-store 为主进程唯一真源，
   * 修改必须经 window.api.hotkeys.set() 成功后回写本缓存，
   * 不提供直接 setter，防止双持久化源漂移）。
   */
  hotkeys: HotkeyOverrides

  /** 全局默认模型（输入框下拉中的默认选中） */
  defaultModel: string

  /** 模型管理列表（设置弹框模型页渲染 + 输入框下拉筛选 enabled 项） */
  modelConfigs: ModelConfigItem[]

  setTheme: (theme: ThemeMode) => void
  initTheme: () => void
  setLanguage: (lang: Language) => void
  setFontSize: (size: FontSizeMode) => void
  /** 一次性将持久化的语言/字号应用到 <html> 属性（首次挂载或 hydration 后调用） */
  initAppearance: () => void

  /**
   * 用主进程返回值回写快捷键缓存（HOTKEYS_SET/RESET 成功后调用）。
   * 仅作缓存同步，不写主进程——SOT 在 electron-store。
   */
  syncHotkeys: (overrides: HotkeyOverrides) => void

  /** 新增或更新模型（按 id 合并） */
  upsertModelConfig: (item: ModelConfigItem) => void

  /** 按 id 删除模型 */
  removeModelConfig: (id: string) => void

  /** 按 id 切换启用状态 */
  toggleModelEnabled: (id: string) => void

  /** 设置全局默认模型 */
  setDefaultModel: (id: string) => void
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

function applyLanguage(language: Language): void {
  const root = document.documentElement
  root.setAttribute('lang', language)
  root.setAttribute('data-language', language)
  // documentElement.lang 同步，辅助第三方无障碍阅读器识别
  if (document.documentElement.lang !== language) document.documentElement.lang = language
}

function applyFontSize(fontSize: FontSizeMode): void {
  const root = document.documentElement
  root.setAttribute('data-font-size', fontSize)
  root.style.setProperty('--app-font-size', `${FONT_SIZE_PX[fontSize]}px`)
  // 让 Tailwind `text-sm / text-base` 的默认 1rem 基线随字号走
  root.style.fontSize = `${FONT_SIZE_PX[fontSize]}px`
}

/** 预置模型（与 InputArea MODEL_OPTIONS 对齐，默认按用户截图状态配置启用） */
const DEFAULT_MODEL_CONFIGS: ModelConfigItem[] = [
  {
    id: 'glm-5.2',
    name: 'glm-5.2',
    provider: '自定义(OpenAI Compatible)',
    iconKey: 'openai-compat',
    enabled: false,
    value: 'glm-5.2'
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek-V4-Flash',
    provider: 'DeepSeek',
    iconKey: 'deepseek',
    enabled: true,
    value: 'deepseek-v4-flash'
  },
  {
    id: 'glm-5-turbo',
    name: 'glm-5-turbo',
    provider: 'Bigmodel',
    iconKey: 'glm',
    enabled: false,
    value: 'glm-5-turbo'
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    provider: 'DeepSeek',
    iconKey: 'deepseek',
    enabled: false,
    value: 'deepseek-v4-Pro'
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax-M2.7',
    provider: 'MiniMax-cn',
    iconKey: 'minimax',
    enabled: false,
    value: 'MiniMax-M2.7'
  }
]

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'light',
      language: 'zh-CN',
      fontSize: 'medium',
      hotkeys: {},
      defaultModel: 'Auto',
      modelConfigs: DEFAULT_MODEL_CONFIGS,

      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      initTheme: () => {
        set((s) => {
          applyTheme(s.theme)
          return s
        })
      },
      setLanguage: (language) => {
        applyLanguage(language)
        set({ language })
      },
      setFontSize: (fontSize) => {
        applyFontSize(fontSize)
        set({ fontSize })
      },
      initAppearance: () => {
        set((s) => {
          applyTheme(s.theme)
          applyLanguage(s.language)
          applyFontSize(s.fontSize)
          return s
        })
      },

      syncHotkeys: (overrides) => set({ hotkeys: overrides }),

      upsertModelConfig: (item) =>
        set((state) => {
          const exists = state.modelConfigs.some((m) => m.id === item.id)
          const next = exists
            ? state.modelConfigs.map((m) => (m.id === item.id ? { ...m, ...item } : m))
            : [...state.modelConfigs, item]
          return { modelConfigs: next }
        }),

      removeModelConfig: (id) =>
        set((state) => ({
          modelConfigs: state.modelConfigs.filter((m) => m.id !== id),
          defaultModel: state.defaultModel === id ? 'Auto' : state.defaultModel
        })),

      toggleModelEnabled: (id) =>
        set((state) => ({
          modelConfigs: state.modelConfigs.map((m) =>
            m.id === id ? { ...m, enabled: !m.enabled } : m
          )
        })),

      setDefaultModel: (id) => set({ defaultModel: id })
    }),
    {
      name: 'pioneering-app',
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        fontSize: state.fontSize,
        // hotkeys 仅作主进程 SOT 的缓存快照持久化：
        // 启动首帧可用（消除 hydrate 时序空窗），App 挂载后 IPC 拉取真源校正
        hotkeys: state.hotkeys,
        defaultModel: state.defaultModel,
        modelConfigs: state.modelConfigs
      })
    }
  )
)
