// ============================================================
// rightPanelStore — 右侧面板标签模型（多标签容器状态中枢）
// ============================================================
// 把原先「单一视图切换 + 产物覆盖层」的右栏，重构为「标签栏 + 内容区」：
//   - 每类内容是一个标签：任务监控 / 任务流水线 / 产物预览
//   - 标签可并存、可切换、可关闭；产物预览不再覆盖任务视图
//   - 扩展新标签类型（本地文件、网页等）时只需追加 RightPanelTabKind 与内容分支
//
// 设计取舍：
//   - 标签载荷（产物正文）不落持久化存储 —— 体积不可控且属会话态；
//     仅面板显隐这类轻量 UI 状态由调用方决定是否持久化。
//   - 产物标签 id 由标题派生（`preview:<标题>`），同名产物重复打开时复用同一标签，
//     避免反复点击产物导致标签无限膨胀。
// ============================================================

import { atom } from 'jotai'
import type { ArtifactType } from '@shared/types'

/** 可预览产物的来源类型（HTML / SVG 走沙箱 iframe，Mermaid 走矢量图，Markdown 走 md 渲染器，其余走代码视图） */
export type ArtifactKind = ArtifactType

/** 产物预览载荷 */
export interface ActiveArtifact {
  /** 来源消息 id；产物来自文件系统时为空串（面板据此隐藏「跳转源消息」） */
  messageId: string
  type: ArtifactKind
  content: string
  language: string
  /** 打开时间戳，作为渲染器 key 的一部分，内容变化时强制重建 */
  openedAt: number
}

/** 标签种类：决定内容区渲染什么 */
export type RightPanelTabKind = 'monitor' | 'pipeline' | 'preview'

/** 面板标签 */
export interface RightPanelTab {
  id: string
  kind: RightPanelTabKind
  /** 标签栏显示标题（产物标签为文件名） */
  title: string
  /** kind === 'preview' 时的产物载荷 */
  artifact?: ActiveArtifact
  /** 是否显示关闭按钮 */
  closable: boolean
}

/** 产物标签 id 前缀 */
export const PREVIEW_TAB_PREFIX = 'preview:'

/** 由标题构造产物标签 id（同名复用） */
export function previewTabId(title: string): string {
  return `${PREVIEW_TAB_PREFIX}${title}`
}

/** 任务类标签的固定定义 */
export const TASK_TABS: Record<'monitor' | 'pipeline', RightPanelTab> = {
  monitor: { id: 'monitor', kind: 'monitor', title: '任务监控', closable: true },
  pipeline: { id: 'pipeline', kind: 'pipeline', title: '任务流水线', closable: true }
}

// ---- 基础状态 ----

/** 面板显隐（右栏是否展开） */
export const rightPanelVisibleAtom = atom(false)

/** 面板最大化（占满内容区，中栏让位） */
export const rightPanelMaximizedAtom = atom(false)

/** 已打开的标签（默认打开「任务监控」：产物列表在此标签内，是最常用的入口） */
export const rightPanelTabsAtom = atom<RightPanelTab[]>([TASK_TABS.monitor])

/** 当前激活标签 id；空串表示无标签（显示空态） */
export const rightPanelActiveTabIdAtom = atom<string>(TASK_TABS.monitor.id)

// ---- 写动作 ----

/** 打开标签：已存在则仅激活（不重复追加），并展开面板 */
export const openTabAtom = atom(null, (get, set, tab: RightPanelTab) => {
  const tabs = get(rightPanelTabsAtom)
  if (!tabs.some((t) => t.id === tab.id)) {
    set(rightPanelTabsAtom, [...tabs, tab])
  }
  set(rightPanelActiveTabIdAtom, tab.id)
  set(rightPanelVisibleAtom, true)
})

/** 激活标签（不改变显隐） */
export const activateTabAtom = atom(null, (_get, set, tabId: string) => {
  set(rightPanelActiveTabIdAtom, tabId)
})

/**
 * 关闭标签。关闭的若是当前激活标签，则激活其原右侧邻居；
 * 右侧无邻居时回退到左侧，两边都没有则进入空态。
 */
export const closeTabAtom = atom(null, (get, set, tabId: string) => {
  const tabs = get(rightPanelTabsAtom)
  const idx = tabs.findIndex((t) => t.id === tabId)
  if (idx === -1) return

  const next = tabs.filter((t) => t.id !== tabId)
  set(rightPanelTabsAtom, next)

  if (get(rightPanelActiveTabIdAtom) !== tabId) return
  const fallback = next[idx] ?? next[idx - 1] ?? null
  set(rightPanelActiveTabIdAtom, fallback?.id ?? '')
})

/** 收起面板（保留标签，仅隐藏） */
export const collapseRightPanelAtom = atom(null, (_get, set) => {
  set(rightPanelVisibleAtom, false)
  set(rightPanelMaximizedAtom, false)
})
