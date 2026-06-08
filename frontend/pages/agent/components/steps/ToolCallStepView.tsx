import React from 'react'
import { Card, Tag, Loading } from 'tdesign-react'
import { ToolsIcon, CloseCircleIcon } from 'tdesign-icons-react'
import type { ToolCallStep } from '../../types'
import { formatJson, statusToTagTheme, statusToLabel } from '../../utils/formatters'

export const ToolCallStepView: React.FC<{ step: ToolCallStep }> = React.memo(({ step }) => {
  const isStreaming = step.status === 'streaming' || step.status === 'pending'

  return (
    <div className="step-tool-call">
      <Card bordered className="step-tool-call-card">
        <div className="step-tool-call-header">
          <div className="step-tool-call-left">
            {isStreaming ? (
              <Loading size="small" />
            ) : step.status === 'error' ? (
              <CloseCircleIcon style={{ color: 'var(--td-error-color)' }} />
            ) : (
              <ToolsIcon style={{ color: 'var(--td-warning-color)' }} />
            )}
            <Tag theme="warning" variant="light" size="small">
              调用工具
            </Tag>
            <span className="step-tool-call-name">{step.toolName}</span>
            <Tag theme={statusToTagTheme(step.status)} variant="light" size="small">
              {statusToLabel(step.status, '已完成')}
            </Tag>
          </div>
        </div>
        {step.arguments && (
          <div className="step-tool-call-args">
            <div className="step-tool-call-label">参数</div>
            <pre className="step-tool-call-code">{formatJson(step.arguments)}</pre>
          </div>
        )}
        {step.errorCode && (
          <div className="step-tool-call-error">
            <Tag theme="danger" variant="light" size="small">
              {step.errorCode}
            </Tag>
          </div>
        )}
      </Card>
    </div>
  )
})
