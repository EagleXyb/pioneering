import React, { useMemo } from 'react'
import { Tag, Progress } from 'tdesign-react'
import type { ChatMessage } from '../shared/types'
import { StepType } from '../shared/types'
import type { RunState } from '../../agent-professional/hooks/useAgentRun'

const PHASE_LABEL: Record<string, { label: string; theme: 'default' | 'primary' | 'warning' | 'success' | 'danger' }> = {
  idle: { label: 'Idle', theme: 'default' },
  thinking: { label: 'Thinking', theme: 'warning' },
  tool_call: { label: 'Tool Call', theme: 'warning' },
  tool_result: { label: 'Receiving', theme: 'primary' },
  text_stream: { label: 'Generating', theme: 'primary' },
  error: { label: 'Error', theme: 'danger' },
  success: { label: 'Done', theme: 'success' },
}

function getCurrentPhase(msg: ChatMessage): string {
  if (msg.steps.length === 0) return 'idle'
  const lastStep = msg.steps[msg.steps.length - 1]
  if (lastStep.status === 'streaming' || lastStep.status === 'pending') {
    return lastStep.type
  }
  return 'idle'
}

function getToolCallCount(msg: ChatMessage): number {
  return msg.steps.filter(s => s.type === StepType.TOOL_CALL).length
}

interface StatusBarProps {
  message: ChatMessage | null
  isGenerating: boolean
  runState?: RunState | null
}

function computeProgress(runState: RunState | null | undefined): number {
  if (!runState) return 0
  const total = runState.phases.length
  const finished = runState.phases.filter(
    (p) => p.status === 'finish' || p.status === 'error',
  ).length
  const inProgress = runState.phases.filter(
    (p) => p.status === 'process',
  ).length
  return Math.round(((finished + inProgress * 0.5) / total) * 100)
}

export const StatusBar: React.FC<StatusBarProps> = ({ message, isGenerating, runState }) => {
  const progressPercent = useMemo(() => computeProgress(runState), [runState])

  if (!message) {
    return (
      <div className="status-bar">
        <Tag theme="default" variant="light" size="small">
          Idle
        </Tag>
        <span className="status-text">Waiting to start</span>
      </div>
    )
  }

  const phase = getCurrentPhase(message)
  const phaseInfo = PHASE_LABEL[phase] || PHASE_LABEL.idle
  const toolCount = getToolCallCount(message)
  const stepCount = message.steps.length

  return (
    <div className="status-bar">
      <Tag theme={phaseInfo.theme} variant="light" size="small">
        {isGenerating ? phaseInfo.label : message.status === 'error' ? 'Error' : message.status === 'loading' ? 'Generating' : 'Done'}
      </Tag>
      {toolCount > 0 && (
        <span className="status-text">
          Tool Calls: {toolCount}        </span>
      )}
      <span className="status-text">
        Steps: {stepCount}
      </span>
      {isGenerating && runState && (
        <div className="status-bar-progress">
          <Progress
            percentage={progressPercent}
            size="small"
            label={false}
            strokeWidth={2}
          />
          {runState.currentIteration > 0 && (
            <span className="status-text status-text-iteration">
              {runState.currentIteration}/{runState.maxIterations}
            </span>
          )}
        </div>
      )}
      {message.status === 'loading' && isGenerating && (
        <span className="status-text status-text-pulse">
          Agent is reasoning...
        </span>
      )}
    </div>
  )
}

export default StatusBar
