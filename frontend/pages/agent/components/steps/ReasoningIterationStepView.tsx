import React from 'react'
import { Tag, Divider } from 'tdesign-react'
import type { ReasoningIterationStep } from '../../types'

export const ReasoningIterationStepView: React.FC<{ step: ReasoningIterationStep }> = React.memo(
  ({ step }) => (
    <Divider align="center" className="step-reasoning-iteration">
      <Tag theme="primary" variant="light" size="small">
        第 {step.iterationIndex}/{step.maxIterations} 轮推理
      </Tag>
    </Divider>
  ),
)
