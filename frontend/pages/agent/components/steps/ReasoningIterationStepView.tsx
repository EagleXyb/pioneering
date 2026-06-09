import React from 'react'
import type { ReasoningIterationStep } from '../../types'

export const ReasoningIterationStepView: React.FC<{ step: ReasoningIterationStep }> =
  React.memo(({ step }) => (
    <div className="step-reasoning-iteration">
      <span className="step-reasoning-iteration-label">
        第 {step.iterationIndex}/{step.maxIterations} 轮推理
      </span>
    </div>
  ))

ReasoningIterationStepView.displayName = 'ReasoningIterationStepView'