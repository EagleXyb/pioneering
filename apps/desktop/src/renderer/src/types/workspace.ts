export interface OpenFile {
  id: string
  name: string
  path: string
  language: string
  content?: string
  isDirty: boolean
}

export interface WorkspaceState {
  openFiles: OpenFile[]
  activeFileId: string | null
  recentProjects: string[]
}
