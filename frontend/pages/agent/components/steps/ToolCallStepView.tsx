import React from 'react'
import { Loading } from 'tdesign-react'
import type { ToolCallStep } from '../../types'
import { formatJson } from '../../utils/formatters'

export const ToolCallStepView: React.FC<{ step: ToolCallStep }> = React.memo(({ step }) => {
  const isStreaming = step.status === 'streaming' || step.status === 'pending'

  return (
    <div className="step-content">
      {isStreaming && step.status === 'pending' ? (
        <div className="step-pending-text">
          <Loading size="small" /> 准备调用 {step.toolName}...
        </div>
      ) : (
        <>
          <div className="step-tool-block">
            <div className="step-tool-block-header">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
              </svg>
              <span className="tool-name">{step.toolName}</span>
              <span>调用</span>
            </div>
            {step.arguments && (
              <div className="step-tool-block-body">{formatJson(step.arguments)}</div>
            )}
          </div>
          {step.errorCode && (
            <div className="step-error-block">
              <span className="error-code">{step.errorCode}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
})

ToolCallStepView.displayName = 'ToolCallStepView'