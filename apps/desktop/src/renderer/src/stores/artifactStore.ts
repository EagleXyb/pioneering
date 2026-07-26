/**
 * 预览面板（Artifact）状态中枢 —— 与 web 端 artifactStore 逻辑一致，
 * 适配桌面端采用 Jotai（与 contextPanelVisibleAtom 同属 UI 状态层）。
 *
 * 关键字段：
 *  - activeArtifactAtom：当前正在预览的产物（null 表示不预览），
 *    其存在即决定右侧栏展示「预览面板」还是「任务流水线面板」。
 *  - highlightMessageIdAtom：临时高亮信号，由预览面板「跳转源消息」写入，
 *    被消息列表消费后清除，用于反向滚动定位 + 高亮对应消息。
 */
import { atom } from 'jotai'
import { contextPanelVisibleAtom } from './atoms'
import type { ArtifactType } from '@shared/types'

/** 可预览产物的来源类型：HTML / SVG 走 iframe，其余走纯文本 code 视图 */
export type ArtifactKind = ArtifactType // 'html' | 'svg' | 'code'

/** 当前正在预览的产物描述 */
export interface ActiveArtifact {
  /** 来源消息 id，用于「跳转源消息」反向联动 */
  messageId: string
  /** 预览类型 */
  type: ArtifactKind
  /** 预览内容（原始代码/标记） */
  content: string
  /** 代码语言（决定下载扩展名与标题） */
  language: string
  /** 打开时间戳，作为 iframe key 的一部分，内容变化时强制重建 */
  openedAt: number
}

// ---- 底层状态 atom ----
export const activeArtifactAtom = atom<ActiveArtifact | null>(null)
export const highlightMessageIdAtom = atom<string | null>(null)

// ---- 派生动作（写动作集中管理，避免组件内散落 set 逻辑）----

/** 打开预览：写入 activeArtifact 并清掉上一次的高亮信号；
 *  同时自动展开右侧栏（contextPanelVisibleAtom），与 web 端「点预览右侧即出现」一致。 */
export const openArtifactAtom = atom(null, (get, set, arg: Omit<ActiveArtifact, 'openedAt'>) => {
  set(activeArtifactAtom, { ...arg, openedAt: Date.now() })
  set(highlightMessageIdAtom, null)
  set(contextPanelVisibleAtom, true)
})

/** 关闭预览：清空 activeArtifact 与高亮信号（右栏是否收起由用户控制，保持与 web 一致） */
export const closeArtifactAtom = atom(null, (get, set) => {
  set(activeArtifactAtom, null)
  set(highlightMessageIdAtom, null)
})

/** 写入「跳转源消息」高亮信号 */
export const highlightMessageAtom = atom(null, (get, set, messageId: string) => {
  set(highlightMessageIdAtom, messageId)
})

/** 消费高亮信号（消息列表定位完成后调用） */
export const clearHighlightAtom = atom(null, (get, set) => {
  set(highlightMessageIdAtom, null)
})

/** 切换会话 / 模式时整体复位 */
export const resetArtifactAtom = atom(null, (get, set) => {
  set(activeArtifactAtom, null)
  set(highlightMessageIdAtom, null)
})
