import React from 'react'
import type { AgentStep } from '../../types'
import { StepType } from '../../types'
import { ThinkingStepView } from './ThinkingStepView'
import { ToolCallStepView } from './ToolCallStepView'
import { ToolResultStepView } from './ToolResultStepView'
import { TextStreamStepView } from './TextStreamStepView'
import { ReasoningIterationStepView } from './ReasoningIterationStepView'
import { ErrorStepView } from './ErrorStepView'

export const StepRenderer: React.FC<{ step: AgentStep }> = React.memo(({ step }) => {
  switch (step.type) {
    case StepType.THINKING:
      return <ThinkingStepView step={step} />
    case StepType.TOOL_CALL:
      return <ToolCallStepView step={step} />
    case StepType.TOOL_RESULT:
      return <ToolResultStepView step={step} />
    case StepType.TEXT_STREAM:
      return <TextStreamStepView step={step} />
    case StepType.REASONING_ITERATION:
      return <ReasoningIterationStepView step={step} />
    case StepType.ERROR:
      return <ErrorStepView step={step} />
    default:
      return null
  }
})
