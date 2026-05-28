export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinkingContent?: string
  answerContent?: string
  status: 'loading' | 'success' | 'error'
  error?: string
  timestamp: number
}

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