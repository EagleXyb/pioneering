export type MessagePhase = 'idle' | 'thinking' | 'tool_calling' | 'generating' | 'done'

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error'

export interface ToolCall {
  id: string
  name: string
  arguments: string
  result?: string
  status: ToolCallStatus
}

export const StepType = {
  THINKING: 'thinking',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  TEXT_STREAM: 'text_stream',
  REASONING_ITERATION: 'reasoning_iteration',
  ERROR: 'error',
} as const

export type StepTypeValue = (typeof StepType)[keyof typeof StepType]

export type StepStatus = 'pending' | 'streaming' | 'success' | 'error'

export interface ThinkingStep {
  id: string
  type: 'thinking'
  content: string
  status: StepStatus
  startTime: number
  endTime?: number
}

export interface ToolCallStep {
  id: string
  type: 'tool_call'
  toolName: string
  arguments: string
  status: StepStatus
  startTime: number
  endTime?: number
  errorCode?: string
}

export interface ToolResultStep {
  id: string
  type: 'tool_result'
  toolCallId: string
  toolName: string
  result: string
  status: StepStatus
  startTime: number
  endTime?: number
  duration?: number
}

export interface TextStreamStep {
  id: string
  type: 'text_stream'
  content: string
  status: StepStatus
  startTime: number
  endTime?: number
}

export interface ReasoningIterationStep {
  id: string
  type: 'reasoning_iteration'
  iterationIndex: number
  maxIterations: number
  status: StepStatus
  startTime: number
  endTime?: number
}

export interface ErrorStep {
  id: string
  type: 'error'
  errorCode: string
  message: string
  status: StepStatus
  startTime: number
  recoverable: boolean
  suggestedAction?: string
}

export type AgentStep =
  | ThinkingStep
  | ToolCallStep
  | ToolResultStep
  | TextStreamStep
  | ReasoningIterationStep
  | ErrorStep

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
  type:
    | 'status'
    | 'thinking_delta'
    | 'thinking_done'
    | 'tool_call_start'
    | 'tool_call_delta'
    | 'tool_call_end'
    | 'tool_result_start'
    | 'tool_result_delta'
    | 'tool_result_end'
    | 'answer_delta'
    | 'answer_done'
    | 'reasoning_iteration'
    | 'error'
  stepId?: string
  iterationIndex?: number
  maxIterations?: number
  status?: string
  content?: string
  error?: string
  errorCode?: string
  id?: string
  name?: string
  arguments?: string
  result?: string
  message?: string
  recoverable?: boolean
  suggestedAction?: string
}
