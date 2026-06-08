import React from 'react'
import { Alert, Button } from 'tdesign-react'
import { RefreshIcon } from 'tdesign-icons-react'
import type { ErrorStep } from '../../types'

export const ErrorStepView: React.FC<{ step: ErrorStep }> = React.memo(({ step }) => (
  <div className="step-error">
    <Alert
      theme="error"
      title={`错误: ${step.errorCode}`}
      message={step.message}
      operation={
        step.recoverable && step.suggestedAction ? (
          <Button theme="primary" variant="outline" size="small">
            <RefreshIcon style={{ marginRight: 4 }} />
            {step.suggestedAction}
          </Button>
        ) : undefined
      }
    />
  </div>
))
