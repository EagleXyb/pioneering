import { atom } from 'jotai'

// 面板尺寸（适合存储频繁独立读写的状态）
export const sidebarWidthAtom = atom(260)
export const chatPanelWidthAtom = atom(380)
export const bottomPanelHeightAtom = atom(200)

// 当前编辑器内光标位置等临时 UI 状态
export const cursorPositionAtom = atom({ line: 1, column: 1 })

// 搜索面板状态
export interface SearchResult {
  file: string
  line: number
  column: number
  content: string
}
export const searchQueryAtom = atom('')
export const searchResultsAtom = atom<SearchResult[]>([])

// Agent 任务进度 (全局浮窗提示用)
export const agentProgressAtom = atom<number | null>(null)
