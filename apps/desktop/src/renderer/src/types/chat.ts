import type { AgentStep, ToolCall, ThinkingBlock } from './agent'

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  thinking?: ThinkingBlock
  toolCalls?: ToolCall[]
  model?: string
  tokenUsage?: {
    prompt: number
    completion: number
    total: number
  }
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  model?: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}
