export interface ChatSession {
  id: string
  title: string
  model: string
  messageCount: number
  createdAt: string
  updatedAt: string
  /** 前端本地状态：是否置顶（不持久化到后端） */
  pinned?: boolean
}

export interface ModelOption {
  id: string
  name: string
  description: string
}
