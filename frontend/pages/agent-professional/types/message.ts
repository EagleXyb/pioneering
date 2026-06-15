import type { AgentStep } from './step'
import { StepType, type StepTypeValue } from './step'

export type MessagePhase = 'idle' | 'thinking' | 'tool_calling' | 'generating' | 'done'

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  steps: AgentStep[]
  status: 'loading' | 'success' | 'error'
  error?: string
  timestamp: number
  currentPhase?: MessagePhase
}

export function getCurrentPhase(msg: AgentMessage): StepTypeValue | 'idle' {
  if (msg.steps.length === 0) return 'idle'
  const lastStep = msg.steps[msg.steps.length - 1]
  if (lastStep.status === 'streaming' || lastStep.status === 'pending') {
    return lastStep.type
  }
  return 'idle'
}

export function getToolCallCount(msg: AgentMessage): number {
  return msg.steps.filter(s => s.type === StepType.TOOL_CALL).length
}

export function getTotalDuration(msg: AgentMessage): number {
  if (msg.steps.length === 0) return 0
  const firstStart = msg.steps[0].startTime
  const lastStep = msg.steps[msg.steps.length - 1]
  const lastEnd = 'endTime' in lastStep ? lastStep.endTime : undefined
  return (lastEnd ?? Date.now()) - firstStart
}
