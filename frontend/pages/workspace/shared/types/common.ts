export type ChatMode = 'normal' | 'professional' | 'task'

export type MessagePhase = 'idle' | 'thinking' | 'tool_calling' | 'generating' | 'done'

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error'

export interface ToolCall {
  id: string
  name: string
  arguments: string
  result?: string
  status: ToolCallStatus
}
