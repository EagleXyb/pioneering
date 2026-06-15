import React from 'react'
import { Tag, Tooltip, Space } from 'tdesign-react'
import type { RunPhase, RunPhaseInfo } from '../hooks/useAgentRun'
import { PHASE_ORDER } from '../hooks/useAgentRun'

interface AgentRunProgressProps {
  phases: RunPhaseInfo[]
  currentPhase: RunPhase
  currentIteration: number
  maxIterations: number
  toolCallCount: number
  isRunning: boolean
}

const PHASE_LABELS: Record<RunPhase, string> = {
  idle: '空闲',
  perception: '感知',
  memory: '记忆',
  thinking: '思考',
  tool_calling: '工具调用',
  generating: '生成',
  done: '完成',
  error: '错误',
}

const PHASE_COLORS: Record<RunPhase, string> = {
  idle: 'default',
  perception: 'primary',
  memory: 'primary',
  thinking: 'warning',
  tool_calling: 'success',
  generating: 'primary',
  done: 'success',
  error: 'danger',
}

export const AgentRunProgress: React.FC<AgentRunProgressProps> = ({
  phases,
  currentPhase,
  currentIteration,
  maxIterations,
  toolCallCount,
  isRunning,
}) => {
  if (!isRunning && currentPhase === 'idle') return null

  return (
    <div className="agent-run-progress">
      <div className="agent-run-phases">
        <Space size="small" align="center">
          {phases.map((phase) => (
            <Tooltip
              key={phase.phase}
              content={`${PHASE_LABELS[phase.phase]} - ${
                phase.status === 'wait'
                  ? '等待中'
                  : phase.status === 'process'
                  ? '进行中'
                  : phase.status === 'error'
                  ? '出错'
                  : '已完成'
              }`}
            >
              <Tag
                theme={PHASE_COLORS[phase.phase] as 'default' | 'primary' | 'warning' | 'success' | 'danger'}
                variant={
                  phase.status === 'process'
                    ? 'outline'
                    : phase.status === 'finish'
                    ? 'light'
                    : 'outline'
                }
                size="small"
                style={{
                  opacity: phase.status === 'wait' ? 0.4 : 1,
                }}
              >
                {PHASE_LABELS[phase.phase]}
              </Tag>
            </Tooltip>
          ))}
        </Space>
      </div>
      {(currentIteration > 0 || toolCallCount > 0) && (
        <div className="agent-run-stats">
          {currentIteration > 0 && (
            <span className="agent-run-stat">
              迭代 {currentIteration}/{maxIterations}
            </span>
          )}
          {toolCallCount > 0 && (
            <span className="agent-run-stat">
              工具调用 {toolCallCount} 次
            </span>
          )}
        </div>
      )}
    </div>
  )
}
