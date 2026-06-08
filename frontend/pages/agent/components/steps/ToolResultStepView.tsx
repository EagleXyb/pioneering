import React from 'react'
import { Tag, Loading, Timeline } from 'tdesign-react'
import { CheckCircleIcon, CloseCircleIcon, TimeIcon } from 'tdesign-icons-react'
import type { ToolResultStep } from '../../types'
import { formatJson, formatDuration } from '../../utils/formatters'

export const ToolResultStepView: React.FC<{ step: ToolResultStep }> = React.memo(({ step }) => {
  const isStreaming = step.status === 'streaming'
  const isError = step.status === 'error'

  return (
    <div className="step-tool-result">
      <Timeline layout="vertical" className="step-tool-result-timeline">
        <Timeline.Item
          label={step.duration ? formatDuration(step.duration) : ''}
          dot={
            isError ? (
              <CloseCircleIcon style={{ color: 'var(--td-error-color)' }} />
            ) : (
              <CheckCircleIcon style={{ color: 'var(--td-success-color)' }} />
            )
          }
        >
          <div className="step-tool-result-header">
            <Tag theme={isError ? 'danger' : 'success'} variant="light" size="small">
              工具结果
            </Tag>
            <span className="step-tool-result-name">{step.toolName}</span>
            {step.duration && (
              <Tag size="small" variant="outline" theme="default">
                <TimeIcon style={{ marginRight: 2 }} />
                {step.duration}ms
              </Tag>
            )}
          </div>
          {step.result && (
            <pre className="step-tool-call-code">{formatJson(step.result)}</pre>
          )}
          {isStreaming && (
            <div className="step-tool-result-loading">
              <Loading size="small" text="接收结果中..." />
            </div>
          )}
        </Timeline.Item>
      </Timeline>
    </div>
  )
})
