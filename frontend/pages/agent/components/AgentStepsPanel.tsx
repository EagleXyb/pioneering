import React from 'react'
import { Button, Tooltip, Empty } from 'tdesign-react'
import { StepRenderer } from './steps'
import {
  RootListIcon,
  ChevronLeftDoubleIcon,
  ChevronRightDoubleIcon,
} from 'tdesign-icons-react'
import type { ChatMessage } from '../types'

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

  const hasSteps = message && message.steps.length > 0

  if (collapsed) {
    return (
      <aside className="agent-steps-panel agent-steps-panel-collapsed">
        <div className="agent-steps-collapsed-stack">
          <Tooltip content="展开步骤面板" placement="left">
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
          <span>执行步骤</span>
          {isGenerating && (
            <span className="agent-steps-panel-live" />
          )}
        </div>
        <div className="agent-steps-panel-actions">
          <Tooltip content="收起面板" placement="bottom">
            <Button
              theme="default"
              variant="text"
              shape="square"
              size="small"
              icon={<ChevronRightDoubleIcon />}
              onClick={() => setCollapsed(true)}
            />
          </Tooltip>
        </div>
      </header>

      <div className="agent-steps-panel-body">
        {hasSteps ? (
          <div className="agent-steps-panel-list">
            {message!.steps.map((step) => (
              <StepRenderer key={step.id} step={step} />
            ))}
          </div>
        ) : (
          <div className="agent-steps-panel-empty">
            <Empty
              description="暂无执行步骤"
              size="small"
            />
          </div>
        )}
      </div>
    </aside>
  )
}

export default AgentStepsPanel
