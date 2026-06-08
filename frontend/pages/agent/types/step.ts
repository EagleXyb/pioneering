export type StepStatus = 'pending' | 'streaming' | 'success' | 'error'

export const StepType = {
  THINKING: 'thinking',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  TEXT_STREAM: 'text_stream',
  REASONING_ITERATION: 'reasoning_iteration',
  ERROR: 'error',
} as const

export type StepTypeValue = (typeof StepType)[keyof typeof StepType]

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
