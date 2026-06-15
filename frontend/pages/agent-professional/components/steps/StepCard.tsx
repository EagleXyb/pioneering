import React, { useState, useCallback } from 'react'
import {
  BugIcon,
  ToolsIcon,
  CheckCircleIcon,
  CloseCircleIcon,
  FileIcon,
  TimeIcon,
} from 'tdesign-icons-react'
import type { AgentStep } from '../../types'
import { StepType } from '../../types'
import { formatDuration } from '../../utils/formatters'

interface StepCardProps {
  step: AgentStep
  index: number
  children: React.ReactNode
}

const STEP_META: Record<
  string,
  { label: string; icon: React.ReactElement; cssType: string }
> = {
  [StepType.THINKING]: {
    label: 'Thinking',
    icon: <BugIcon />,
    cssType: 'thinking',
  },
  [StepType.TOOL_CALL]: {
    label: 'Tool Call',
    icon: <ToolsIcon />,
    cssType: 'action',
  },
  [StepType.TOOL_RESULT]: {
    label: 'Tool Result',
    icon: <FileIcon />,
    cssType: 'observation',
  },
  [StepType.TEXT_STREAM]: {
    label: 'Generating',
    icon: <CheckCircleIcon />,
    cssType: 'result',
  },
  [StepType.ERROR]: {
    label: 'Error',
    icon: <CloseCircleIcon />,
    cssType: 'error',
  },
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  streaming: 'Running',
  success: 'Done',
  error: 'Failed',
}

function getDuration(step: AgentStep): string {
  if ('endTime' in step && step.endTime && 'startTime' in step && step.startTime) {
    return formatDuration(step.endTime - step.startTime)
  }
  if ('duration' in step && step.duration) {
    return formatDuration(step.duration)
  }
  if (step.status === 'streaming' && 'startTime' in step && step.startTime) {
    return formatDuration(Date.now() - step.startTime)
  }
  return ''
}

export const StepCard: React.FC<StepCardProps> = React.memo(({ step, index, children }) => {
  const [collapsed, setCollapsed] = useState(false)
  const meta = STEP_META[step.type]
  const isStreaming = step.status === 'streaming'
  const isError = step.status === 'error'
  const duration = getDuration(step)
  const statusLabel = STATUS_LABEL[step.status] || step.status

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  if (!meta) {
    return <>{children}</>
  }

  return (
    <div
      className={`step-card ${collapsed ? 'collapsed' : ''}`}
      data-type={meta.cssType}
      data-status={step.status}
    >
      <div className="step-connector" />
      <div className="step-inner">
        <div className="step-header" onClick={toggleCollapsed}>
          <div className="step-header-left">
            <div className="step-icon">{meta.icon}</div>
            <span className="step-badge">{meta.label}</span>
            <span className="step-number">#{index + 1}</span>
          </div>
          <div className="step-header-right">
            {duration && <span className="step-duration">{duration}</span>}
            <span className={`step-status-tag ${step.status}`}>
              {statusLabel}
            </span>
            <div className="step-toggle">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        </div>
        <div className="step-body">
          {isStreaming && step.type === StepType.TEXT_STREAM
            ? children
            : children}
        </div>
      </div>
    </div>
  )
})

StepCard.displayName = 'StepCard'

export default StepCard
