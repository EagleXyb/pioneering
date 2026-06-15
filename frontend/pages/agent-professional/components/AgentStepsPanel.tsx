import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Button, Tooltip, Empty } from 'tdesign-react'
import { StepRenderer } from './steps'
import {
  RootListIcon,
} from 'tdesign-icons-react'
import { formatDuration } from '../utils/formatters'
import type { ChatMessage } from '../../workspace/shared/types'

const MinusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" />
  </svg>
)

interface AgentStepsPanelProps {
  message: ChatMessage | null
  isGenerating: boolean
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export const AgentStepsPanel: React.FC<AgentStepsPanelProps> = ({
  message,
  isGenerating,
  collapsed = false,
  onToggleCollapsed,
}) => {
  const setCollapsed = onToggleCollapsed || (() => {})

  const rawSteps = message?.steps ?? []
  const steps = useMemo(() => {
    // Deduplicate by id to avoid React key warnings
    const seen = new Set<string>()
    return rawSteps.filter(s => {
      if (seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })
  }, [rawSteps])
  const hasSteps = steps.length > 0

  // Stats: completed / total
  const completedCount = steps.filter(
    (s) => s.status === 'success' || s.status === 'error',
  ).length

  // Real-time timer
  const [elapsedMs, setElapsedMs] = useState(0)

  const getFirstStepTime = useCallback(() => {
    if (steps.length === 0) return 0
    return steps[0].startTime
  }, [steps])

  useEffect(() => {
    if (!isGenerating || steps.length === 0) {
      // 鍙栨渶鍚庝竴涓?step 鐨?endTime 鎴?startTime 绠楁渶缁堣€楁椂
      const lastStep = steps[steps.length - 1]
      if (lastStep && 'endTime' in lastStep && lastStep.endTime && 'startTime' in lastStep) {
        setElapsedMs(lastStep.endTime - lastStep.startTime)
      } else if (lastStep) {
        setElapsedMs(0)
      }
      return
    }

    const firstTime = getFirstStepTime()
    if (!firstTime) return

    const tick = () => setElapsedMs(Date.now() - firstTime)
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [isGenerating, steps, getFirstStepTime])

  const elapsedStr = elapsedMs > 0 ? formatDuration(elapsedMs) : ''

  if (collapsed) {
    return (
      <aside className="agent-steps-panel agent-steps-panel-collapsed">
        <div className="agent-steps-collapsed-stack">
          <Tooltip content="Expand Steps Panel" placement="left">
            <Button
              theme="default"
              variant="text"
              shape="square"
              icon={
                <RootListIcon style={{ color: 'var(--ag-accent, #4f46e5)' }} />
              }
              onClick={() => setCollapsed(false)}
            />
          </Tooltip>
          {hasSteps && (
            <div className="agent-steps-collapsed-indicator" />
          )}
        </div>
      </aside>
    )
  }

  return (
    <aside className="agent-steps-panel">
      <header className="agent-steps-panel-header">
        <div className="agent-steps-panel-title">
          <RootListIcon style={{ color: 'var(--ag-accent, #4f46e5)' }} />
          <span>Execution Steps</span>
          {isGenerating && (
            <span className="agent-steps-panel-live" />
          )}
        </div>
        <div className="agent-steps-panel-actions">
          <Tooltip content="Hide Panel" placement="bottom">
            <Button
              theme="default"
              variant="text"
              shape="square"
              size="small"
              icon={<MinusIcon />}
              onClick={() => setCollapsed(true)}
            />
          </Tooltip>
        </div>
      </header>

      {hasSteps && (
        <div className="agent-steps-panel-stats">
          <div className="agent-steps-panel-stats-progress">
            <span>Steps</span>
            <span className="agent-steps-panel-stats-count">
              {completedCount}/{steps.length}
            </span>
          </div>
          {elapsedStr && (
            <span className="agent-steps-panel-stats-elapsed">{elapsedStr}</span>
          )}
        </div>
      )}

      <div className="agent-steps-panel-body">
        {hasSteps ? (
          <div className="agent-steps-panel-list">
            {steps.map((step, idx) => (
              <StepRenderer key={step.id} step={step} index={idx} />
            ))}
          </div>
        ) : (
          <div className="agent-steps-panel-empty">
            <Empty
              description="No execution steps yet"
              size="small"
            />
          </div>
        )}
      </div>
    </aside>
  )
}

export default AgentStepsPanel
