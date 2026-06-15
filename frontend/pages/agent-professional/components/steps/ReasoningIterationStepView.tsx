import React from 'react'
import type { ReasoningIterationStep } from '../../types'

export const ReasoningIterationStepView: React.FC<{ step: ReasoningIterationStep }> =
  React.memo(({ step }) => (
    <div className="step-reasoning-iteration">
      <span className="step-reasoning-iteration-label">
        Round {step.iterationIndex}/{step.maxIterations} Reasoning      </span>
    </div>
  ))

ReasoningIterationStepView.displayName = 'ReasoningIterationStepView'
