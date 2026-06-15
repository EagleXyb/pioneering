import React, { useMemo } from 'react'
import { Tag } from 'tdesign-react'
import { CheckCircleFilledIcon, TimeIcon } from 'tdesign-icons-react'
import type { RunState, RunPhase } from '../../agent-professional/hooks/useAgentRun'

interface ActivityPanelProps {
  runState: RunState | null
  collapsed?: boolean
}

const PHASE_CONFIG: Record<
  RunPhase,
  { title: string; description: string }
> = {
  idle: {
    title: 'Waiting',
    description: 'Waiting for user input',
  },
  perception: {
    title: 'Perception',
    description: 'Understanding the context and environment',
  },
  memory: {
    title: 'Memory Search',
    description: 'Searching relevant context',
  },
  thinking: {
    title: 'Planning',
    description: 'Analyzing and reasoning',
  },
  tool_calling: {
    title: 'Tool Call',
    description: 'Executing external tools',
  },
  generating: {
    title: 'Generating',
    description: 'Generating final response',
  },
  done: {
    title: 'Done',
    description: 'Response generated',
  },
  error: {
    title: 'Error',
    description: 'Execution error',
  },
}

export const ActivityPanel: React.FC<ActivityPanelProps> = ({
  runState,
  collapsed = false,
}) => {
  const progress = useMemo(() => {
    if (!runState) {
      return { finished: 0, total: 0, percent: 0 }
    }
    const total = runState.phases.length
    const finished = runState.phases.filter(
      (p) => p.status === 'finish' || p.status === 'error',
    ).length
    const percent = total > 0 ? Math.round((finished / total) * 100) : 0
    return { finished, total, percent }
  }, [runState])

  const isAllDone =
    runState && progress.finished === progress.total && progress.total > 0
  const statusTag = !runState
    ? { theme: 'default' as const, text: 'Pending' }
    : isAllDone
      ? { theme: 'success' as const, text: 'Done' }
      : runState.currentPhase === 'error'
        ? { theme: 'danger' as const, text: 'Failed' }
        : { theme: 'primary' as const, text: 'Running' }

  if (!runState) {
    return (
      <div className="activity-panel activity-panel-empty">
        <Tag theme="default" variant="light" size="small">
          Waiting to start        </Tag>
      </div>
    )
  }

  if (collapsed) {
    return (
      <div className="activity-panel activity-panel-collapsed">
        <Tag theme={statusTag.theme} variant="light" size="small">
          {statusTag.text}
        </Tag>
        <div className="activity-panel-collapsed-progress">
          <div
            className="activity-panel-collapsed-bar"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="activity-panel">
      {/* Header: title + status tag */}
      <div className="activity-panel-header">
        <div className="activity-panel-header-title-group">
          <span className="activity-panel-title">Agent Execution Flow</span>
          <span className="activity-panel-meta">
            {progress.finished}/{progress.total} steps
          </span>
        </div>
        <Tag theme={statusTag.theme} variant="light" size="small">
          {statusTag.text}
        </Tag>
      </div>

      {/* Progress bar */}
      <div className="activity-panel-progress">
        <div className="activity-panel-progress-bar">
          <div
            className="activity-panel-progress-fill"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <span className="activity-panel-progress-label">
          {progress.percent}%
        </span>
      </div>

      {/* Steps list */}
      <ol className="activity-panel-list">
        {runState.phases.map((phaseInfo, index) => {
          const config = PHASE_CONFIG[phaseInfo.phase] || {
            title: phaseInfo.phase,
            description: '',
          }
          const isFinished = phaseInfo.status === 'finish'
          const isError = phaseInfo.status === 'error'
          const isProcess = phaseInfo.status === 'process'
          const isPending =
            !isFinished && !isError && !isProcess

          return (
            <li
              key={phaseInfo.phase}
              className={[
                'activity-list-item',
                isFinished && 'is-finished',
                isError && 'is-error',
                isProcess && 'is-process',
                isPending && 'is-pending',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <span className="activity-list-marker">
                <span className="activity-list-marker-dot" />
                {isProcess && (
                  <span className="activity-list-marker-pulse" />
                )}
              </span>
              <div className="activity-list-content">
                <div className="activity-list-title-row">
                  <span className="activity-list-title">{config.title}</span>
                  {isFinished && (
                    <CheckCircleFilledIcon className="activity-list-check" />
                  )}
                </div>
                {config.description && (
                  <div className="activity-list-description">
                    {config.description}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {runState.currentIteration > 0 && (
        <div className="activity-panel-iteration">
          <span className="activity-panel-iteration-text">
            <TimeIcon /> Iteration {runState.currentIteration}/
            {runState.maxIterations} &middot; Tool Calls {runState.toolCallCount}
          </span>
        </div>
      )}
    </div>
  )
}

export default ActivityPanel
