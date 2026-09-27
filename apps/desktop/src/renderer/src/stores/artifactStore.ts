/**
 * 预览面板（Artifact）状态中枢 —— 产物预览已纳入右侧面板标签模型，
 * 本模块保留「产物 ⇄ 标签」的桥接与消息高亮信号。
 *
 * 多标签改造要点：
 *  - activeArtifactAtom 由「可写单例」改为「派生自激活标签」：
 *    仅当激活标签是产物标签时才有值，标签切换即自然驱动预览内容切换，
 *    不再需要额外同步两份状态。
 *  - openArtifactAtom 不再直接写单例，而是新增/激活一个产物标签
 *    （同名产物复用同一标签，避免反复点击导致标签膨胀）。
 *  - closeArtifactAtom 关闭当前产物标签，而非清空单例。
 */
import { atom } from 'jotai'
import type { ArtifactType } from '@shared/types'
import {
  PREVIEW_TAB_PREFIX,
  closeAllPreviewTabsAtom,
  closeTabAtom,
  openTabAtom,
  previewTabId,
  rightPanelActiveTabIdAtom,
  rightPanelTabsAtom,
  type ActiveArtifact
} from './rightPanelStore'

// 载荷类型统一从标签模型导出，保持既有 import 路径（'@/stores/artifactStore'）可用
export type { ActiveArtifact, ArtifactKind } from './rightPanelStore'

/** 产物类型 → 默认标签标题（调用方未指定标题时使用） */
const DEFAULT_PREVIEW_TITLE: Record<ArtifactType, string> = {
  html: 'HTML 预览',
  svg: 'SVG 预览',
  mermaid: '图表预览',
  markdown: 'Markdown 预览',
  code: '代码预览'
}

/** 打开产物预览的入参：openedAt 由本模块补齐，title 用于标签栏展示 */
export type OpenArtifactArg = Omit<ActiveArtifact, 'openedAt'> & {
  /** 标签标题；缺省按产物类型取默认名（产物文件建议传文件名） */
  title?: string
}

// ---- 底层状态 atom ----

/** 临时高亮信号：由产物预览「跳转源消息」写入，被消息列表消费后清除 */
export const highlightMessageIdAtom = atom<string | null>(null)

/** 当前激活标签为产物标签时返回其载荷，否则为 null */
export const activeArtifactAtom = atom<ActiveArtifact | null>((get) => {
  const activeId = get(rightPanelActiveTabIdAtom)
  if (!activeId) return null
  const tab = get(rightPanelTabsAtom).find((t) => t.id === activeId)
  return tab?.kind === 'preview' ? tab.artifact ?? null : null
})

// ---- 派生动作（写动作集中管理，避免组件内散落 set 逻辑）----

/** 打开产物预览：作为标签打开（同名复用），并展开面板 */
export const openArtifactAtom = atom(null, (_get, set, arg: OpenArtifactArg) => {
  const { title, ...rest } = arg
  const resolvedTitle = title?.trim() || DEFAULT_PREVIEW_TITLE[rest.type] || '预览'
  set(openTabAtom, {
    id: previewTabId(resolvedTitle),
    kind: 'preview',
    title: resolvedTitle,
    artifact: { ...rest, openedAt: Date.now() },
    closable: true
  })
  set(highlightMessageIdAtom, null)
})

/** 关闭当前产物预览标签；激活的是任务标签时为空操作 */
export const closeArtifactAtom = atom(null, (get, set) => {
  const activeId = get(rightPanelActiveTabIdAtom)
  if (activeId.startsWith(PREVIEW_TAB_PREFIX)) set(closeTabAtom, activeId)
})

/** 写入「跳转源消息」高亮信号 */
export const highlightMessageAtom = atom(null, (_get, set, messageId: string) => {
  set(highlightMessageIdAtom, messageId)
})

/** 消费高亮信号（消息列表定位完成后调用） */
export const clearHighlightAtom = atom(null, (_get, set) => {
  set(highlightMessageIdAtom, null)
})

/** 切换会话 / 模式时整体复位：关闭全部产物标签并清理高亮信号 */
export const resetArtifactAtom = atom(null, (_get, set) => {
  set(closeAllPreviewTabsAtom)
  set(highlightMessageIdAtom, null)
})
