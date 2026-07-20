// ============================================================
// feature-flags — T10/T14 共用的特性开关基础设施
// ============================================================
// 设计目标：
//   1. 默认关闭所有用户可感知行为变更的 feature（安全默认）
//   2. 持久化到 localStorage，用户切换后下次启动保留
//   3. 类型安全：所有 flag 在 FeatureFlags 类型中集中声明
//   4. 可在控制台手动启用：window.__toggleFeature('xxx', true)
//
// 添加新 flag 步骤：
//   1. 在 FeatureFlags 接口中声明，并在 DEFAULT_FLAGS 中给默认值
//   2. 在 SettingsDialog 中暴露开关（可选）
//   3. 通过 useFeatureFlag('xxx') 或 isFeatureEnabled('xxx') 读取
// ============================================================

import { useSyncExternalStore } from 'react'

/**
 * 全部特性开关集中声明。
 * 命名规范：domain-action，如 messageScroller、scrollLastAnchor。
 */
export interface FeatureFlags {
  /**
   * T10/T11：启用 Message Scroller 替换 ScrollArea + 虚拟化。
   * 关闭时使用原有 ScrollArea + isNearBottomRef + @tanstack/react-virtual。
   * 默认关，灰度验证后开。
   */
  messageScroller: boolean

  /**
   * T14：重开会话时定位到最后一条 user 消息（last-anchor）。
   * 关闭时保持原行为（直接拉到底部）。
   * 仅在 messageScroller 启用时生效。
   * 默认关，避免改变用户习惯。
   */
  scrollLastAnchor: boolean

  /**
   * T12：新 turn 锚定到视口顶部附近（而非底部）。
   * 仅在 messageScroller 启用时生效。
   * 默认开（与官方默认一致，且解决流式拉回痛点）。
   */
  scrollAnchorTurns: boolean

  /**
   * T13：显示「跳到最新」浮动按钮。
   * 仅在 messageScroller 启用时生效。
   * 默认开。
   */
  scrollJumpButton: boolean

  /**
   * T09：开发期压测开关，注入大量 mock 消息。
   * 默认关，仅 dev 环境可用。
   */
  devStressMessages: boolean

  /**
   * T09：dev 压测注入的消息条数。
   */
  devStressCount: number

  /**
   * T15：上下文压缩环启用开关。
   * 待后端压缩 API 就绪后才能启用，目前保持关。
   * ContextRing 组件已实现，仅在 InputArea 中接入时受此 flag 控制。
   */
  contextCompression: boolean
}

const DEFAULT_FLAGS: FeatureFlags = {
  messageScroller: false,
  scrollLastAnchor: false,
  scrollAnchorTurns: true,
  scrollJumpButton: true,
  devStressMessages: false,
  devStressCount: 1000,
  contextCompression: false
}

const STORAGE_KEY = 'pioneering:feature-flags'

function loadFlags(): FeatureFlags {
  // 合并默认值与持久化值，避免新 flag 上线时旧 localStorage 缺字段
  try {
    const raw = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_FLAGS }
    const parsed = JSON.parse(raw) as Partial<FeatureFlags>
    return { ...DEFAULT_FLAGS, ...parsed }
  } catch {
    return { ...DEFAULT_FLAGS }
  }
}

let currentFlags: FeatureFlags = loadFlags()
const listeners = new Set<() => void>()

function persist() {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentFlags))
    }
  } catch {
    // 忽略 quota / 隐私模式异常
  }
}

function emit() {
  for (const l of listeners) l()
}

/** 命令式读取，非 React 上下文使用 */
export function isFeatureEnabled<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  return currentFlags[key]
}

/** 命令式更新，会持久化并通知所有订阅 */
export function setFeatureFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
  currentFlags = { ...currentFlags, [key]: value }
  persist()
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot(): FeatureFlags {
  return currentFlags
}

/** React Hook 读取单个 flag，flag 变化时自动重渲染 */
export function useFeatureFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_FLAGS // SSR 快照（本项目无 SSR，但 useSyncExternalStore 要求）
  )[key]
}

/** React Hook 读取全部 flag */
export function useFeatureFlags(): FeatureFlags {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_FLAGS)
}

// 暴露到 window 方便控制台调试（仅 dev）
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  const w = window as unknown as {
    __toggleFeature?: <K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]) => void
    __featureFlags?: () => FeatureFlags
  }
  w.__toggleFeature = (key, value) => setFeatureFlag(key, value)
  w.__featureFlags = () => ({ ...currentFlags })
}
