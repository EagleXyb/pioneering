// ============================================================
// Workspace Store — 工作区状态管理 (Zustand)
// 注意：工作区文件编辑功能为半成品，当前仅支持打开/关闭/切换标签页，
// 真正的文件写入/脏标记/最近项目等功能待后续需求明确后再补全。
// ============================================================

import { create } from 'zustand'
import type { OpenFile } from '@shared/types'

interface WorkspaceState {
  openFiles: OpenFile[]
  activeFileId: string | null

  openFile: (file: OpenFile) => void
  closeFile: (fileId: string) => void
  setActiveFile: (fileId: string) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  openFiles: [],
  activeFileId: null,

  openFile: (file) => {
    set((s) => {
      const exists = s.openFiles.find((f) => f.id === file.id)
      if (exists) {
        return { activeFileId: file.id }
      }
      return {
        openFiles: [...s.openFiles, file],
        activeFileId: file.id
      }
    })
  },

  closeFile: (fileId) => {
    set((s) => {
      const remaining = s.openFiles.filter((f) => f.id !== fileId)
      const newActive =
        s.activeFileId === fileId
          ? remaining.length > 0
            ? remaining[remaining.length - 1]!.id
            : null
          : s.activeFileId
      return { openFiles: remaining, activeFileId: newActive }
    })
  },

  setActiveFile: (fileId) => set({ activeFileId: fileId })
}))

// 派生：当前激活文件。集中替换各处 `openFiles.find(f => f.id === activeFileId)`，
// 避免重复线性查找与逻辑漂移（R3）。
export function useActiveFile(): OpenFile | undefined {
  return useWorkspaceStore((s) => s.openFiles.find((f) => f.id === s.activeFileId))
}
