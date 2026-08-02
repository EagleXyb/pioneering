// ============================================================
// feature-flags — dev 压测开关基础设施
// ============================================================
// 设计目标：
//   1. 默认关闭所有用户可感知行为变更的 feature（安全默认）
//   2. 持久化到 localStorage，用户切换后下次启动保留
//   3. 类型安全：所有 flag 在 FeatureFlags 类型中集中声明
//   4. 可在控制台手动启用：window.__toggleFeature('xxx', true)
//
// 收敛说明（原 T10/T11/T12/T13/T14/T15/P2 flag 已移除）：
//   - messageScroller 系列（messageScroller/scrollLastAnchor/scrollAnchorTurns/
//     scrollJumpButton）：MessageScrollerList 已成为唯一实现，flag 移除
//   - mermaidPreview：mermaid 预览默认开启，降级路径安全，flag 移除
//   - contextCompression：ContextRing 组件与 flag 均未被消费，一并移除
//   - 仅保留 devStressMessages/devStressCount 用于开发期压测
// ============================================================

import { useSyncExternalStore } from 'react'

/**
 * 全部特性开关集中声明。
 * 收敛后仅保留 dev 压测相关 flag。
 */
export interface FeatureFlags {
  /**
   * T09：开发期压测开关，注入大量 mock 消息。
   * 默认关，仅 dev 环境可用。
   */
  devStressMessages: boolean

  /**
   * T09：dev 压测注入的消息条数。
   */
  devStressCount: number
}

const DEFAULT_FLAGS: FeatureFlags = {
  devStressMessages: false,
  devStressCount: 1000
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
