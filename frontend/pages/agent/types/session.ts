export interface ChatSession {
  id: string
  title: string
  model: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface ModelOption {
  id: string
  name: string
  description: string
}
