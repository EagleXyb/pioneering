import React from 'react'
import type { AgentStep } from '../../types'
import { StepType } from '../../types'
import { StepCard } from './StepCard'
import { ThinkingStepView } from './ThinkingStepView'
import { ToolCallStepView } from './ToolCallStepView'
import { ToolResultStepView } from './ToolResultStepView'
import { TextStreamStepView } from './TextStreamStepView'
import { ReasoningIterationStepView } from './ReasoningIterationStepView'
import { ErrorStepView } from './ErrorStepView'

interface StepRendererProps {
  step: AgentStep
  index: number
}

export const StepRenderer: React.FC<StepRendererProps> = React.memo(({ step, index }) => {
  // ReasoningIteration 不使用 StepCard，使用独立的分隔条样式
  if (step.type === StepType.REASONING_ITERATION) {
    return <ReasoningIterationStepView step={step} />
  }

  const renderContent = () => {
    switch (step.type) {
      case StepType.THINKING:
        return <ThinkingStepView step={step} />
      case StepType.TOOL_CALL:
        return <ToolCallStepView step={step} />
      case StepType.TOOL_RESULT:
        return <ToolResultStepView step={step} />
      case StepType.TEXT_STREAM:
        return <TextStreamStepView step={step} />
      case StepType.ERROR:
        return <ErrorStepView step={step} />
      default:
        return null
    }
  }

  return (
    <StepCard step={step} index={index}>
      {renderContent()}
    </StepCard>
  )
})

StepRenderer.displayName = 'StepRenderer'