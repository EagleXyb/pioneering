// Re-export from shared types
export type { StepStatus, StepTypeValue } from '../../workspace/shared/types'
export { StepType } from '../../workspace/shared/types'
export type {
  AgentStep,
  ThinkingStep,
  ToolCallStep,
  ToolResultStep,
  TextStreamStep,
  ReasoningIterationStep,
  ErrorStep,
} from '../../workspace/shared/types'

// Message types
export type { MessagePhase, ToolCallStatus, ToolCall, ChatMessage } from '../../workspace/shared/types'
export { getCurrentPhase, getToolCallCount, getTotalDuration } from './message-utils'

// Event types
export type { StreamEvent } from './event'
