// ============================================================
// Workspace Store — 工作区状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import type { OpenFile } from '@shared/types'
import { RECENT_PROJECTS_LIMIT } from '@/lib/constants'

interface WorkspaceState {
  openFiles: OpenFile[]
  activeFileId: string | null
  recentProjects: string[]

  openFile: (file: OpenFile) => void
  closeFile: (fileId: string) => void
  setActiveFile: (fileId: string) => void
  updateFileContent: (fileId: string, content: string) => void
  markFileDirty: (fileId: string, dirty: boolean) => void
  addRecentProject: (path: string) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  openFiles: [],
  activeFileId: null,
  recentProjects: [],

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

  setActiveFile: (fileId) => set({ activeFileId: fileId }),

  updateFileContent: (fileId, content) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.id === fileId ? { ...f, content, isDirty: true } : f
      )
    }))
  },

  markFileDirty: (fileId, dirty) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.id === fileId ? { ...f, isDirty: dirty } : f
      )
    }))
  },

  addRecentProject: (path) => {
    set((s) => ({
      recentProjects: [path, ...s.recentProjects.filter((p) => p !== path)].slice(0, RECENT_PROJECTS_LIMIT)
    }))
  }
}))

// 派生：当前激活文件。集中替换各处 `openFiles.find(f => f.id === activeFileId)`，
// 避免重复线性查找与逻辑漂移（R3）。
export function useActiveFile(): OpenFile | undefined {
  return useWorkspaceStore((s) => s.openFiles.find((f) => f.id === s.activeFileId))
}
