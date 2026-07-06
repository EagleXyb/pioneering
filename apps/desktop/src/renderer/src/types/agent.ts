export interface AgentStep {
  id: string
  description: string
  toolName?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  result?: string
  startTime?: number
  endTime?: number
}

export interface AgentExecution {
  id: string
  instruction: string
  steps: AgentStep[]
  status: 'idle' | 'running' | 'completed' | 'error'
  error?: string
  createdAt: number
  updatedAt: number
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  result?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  startTime?: number
  endTime?: number
}

export interface ThinkingBlock {
  content: string
  duration?: number
}
