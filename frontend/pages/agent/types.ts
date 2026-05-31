export type MessagePhase = 'idle' | 'thinking' | 'tool_calling' | 'generating' | 'done'

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error'

export interface ToolCall {
  id: string
  name: string
  arguments: string
  result?: string
  status: ToolCallStatus
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinkingContent?: string
  answerContent?: string
  toolCalls?: ToolCall[]
  currentPhase?: MessagePhase
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

export interface StreamEvent {
  type: 'status' | 'thinking_delta' | 'thinking_done' |
        'tool_call_start' | 'tool_call_delta' | 'tool_call_end' |
        'answer_delta' | 'answer_done' | 'error'
  status?: string
  content?: string
  error?: string
  id?: string
  name?: string
  arguments?: string
  result?: string
  message?: string
}