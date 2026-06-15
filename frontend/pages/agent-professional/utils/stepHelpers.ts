import type { AgentStep } from '../types'
import { StepType, type StepTypeValue } from '../types'

export function rebuildAnswerContent(steps: AgentStep[]): string {
  return steps
    .filter(s => s.type === StepType.TEXT_STREAM)
    .map(s => (s as import('../types').TextStreamStep).content)
    .join('')
}

export function statusToPhase(status: string): StepTypeValue | undefined {
  const statusToPhase: Record<string, StepTypeValue> = {
    perception: StepType.THINKING,
    memory: StepType.THINKING,
    reasoning: StepType.THINKING,
    tool_calling: StepType.TOOL_CALL,
    generating: StepType.TEXT_STREAM,
    done: StepType.TEXT_STREAM,
  }
  return statusToPhase[status]
}
