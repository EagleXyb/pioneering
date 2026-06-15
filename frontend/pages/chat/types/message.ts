import type { AgentStep } from './step'
import { StepType, type StepTypeValue } from './step'

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
  steps: AgentStep[]
  status: 'loading' | 'success' | 'error'
  error?: string
  timestamp: number
  thinkingContent?: string
  answerContent?: string
  toolCalls?: ToolCall[]
  currentPhase?: MessagePhase
}

export function getCurrentPhase(msg: ChatMessage): StepTypeValue | 'idle' {
  if (msg.steps.length === 0) return 'idle'
  const lastStep = msg.steps[msg.steps.length - 1]
  if (lastStep.status === 'streaming' || lastStep.status === 'pending') {
    return lastStep.type
  }
  return 'idle'
}

export function getToolCallCount(msg: ChatMessage): number {
  return msg.steps.filter(s => s.type === StepType.TOOL_CALL).length
}

export function getTotalDuration(msg: ChatMessage): number {
  if (msg.steps.length === 0) return 0
  const firstStart = msg.steps[0].startTime
  const lastStep = msg.steps[msg.steps.length - 1]
  const lastEnd = 'endTime' in lastStep ? lastStep.endTime : undefined
  return (lastEnd ?? Date.now()) - firstStart
}
