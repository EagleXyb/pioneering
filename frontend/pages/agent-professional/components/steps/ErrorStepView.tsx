import React from 'react'
import { Button } from 'tdesign-react'
import { RefreshIcon } from 'tdesign-icons-react'
import type { ErrorStep } from '../../types'

export const ErrorStepView: React.FC<{ step: ErrorStep }> = React.memo(({ step }) => (
  <div className="step-content">
    <div className="step-error-block">
      <div className="error-code">{step.errorCode}</div>
      <div>{step.message}</div>
      {step.recoverable && step.suggestedAction && (
        <div className="retry-btn">
          <Button theme="primary" variant="outline" size="small">
            <RefreshIcon style={{ marginRight: 4 }} />
            {step.suggestedAction}
          </Button>
        </div>
      )}
    </div>
  </div>
))

ErrorStepView.displayName = 'ErrorStepView'