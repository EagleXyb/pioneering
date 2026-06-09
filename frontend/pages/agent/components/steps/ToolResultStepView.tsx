import React from 'react'
import { Loading } from 'tdesign-react'
import type { ToolResultStep } from '../../types'
import { formatJson } from '../../utils/formatters'

export const ToolResultStepView: React.FC<{ step: ToolResultStep }> = React.memo(({ step }) => {
  const isStreaming = step.status === 'streaming'
  const isError = step.status === 'error'

  return (
    <div className="step-content">
      {isStreaming && (
        <div className="step-pending-text">
          <Loading size="small" /> 接收结果中...
        </div>
      )}
      <div className="step-tool-block">
        <div className="step-tool-block-header">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="tool-name">{step.toolName}</span>
          <span>返回结果</span>
        </div>
        {step.result && (
          <div className="step-tool-block-body">{formatJson(step.result)}</div>
        )}
      </div>
    </div>
  )
})

ToolResultStepView.displayName = 'ToolResultStepView'