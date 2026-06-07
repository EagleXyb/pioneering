import React, { useMemo } from 'react'
import { Steps, Progress, Tag } from 'tdesign-react'
import {
  BrowseIcon,
  BrowseOffIcon,
  RootListIcon,
  ToolsIcon,
  FileIcon,
  CheckCircleIcon,
  ErrorCircleIcon,
  TimeIcon,
} from 'tdesign-icons-react'
import type { RunState, RunPhase } from '../hooks/useAgentRun'

interface ActivityPanelProps {
  runState: RunState | null
  collapsed?: boolean
}

const PHASE_CONFIG: Record<
  RunPhase,
  { title: string; icon: React.ReactNode; description: string }
> = {
  idle: {
    title: '等待',
    icon: <TimeIcon />,
    description: '等待用户输入',
  },
  perception: {
    title: '感知解析',
    icon: <BrowseIcon />,
    description: '解析用户输入意图',
  },
  memory: {
    title: '记忆检索',
    icon: <BrowseOffIcon />,
    description: '检索相关上下文',
  },
  thinking: {
    title: '深度思考',
    icon: <RootListIcon />,
    description: '分析问题并推理',
  },
  tool_calling: {
    title: '调用工具',
    icon: <ToolsIcon />,
    description: '执行外部工具调用',
  },
  generating: {
    title: '生成回答',
    icon: <FileIcon />,
    description: '生成最终回复',
  },
  done: {
    title: '完成',
    icon: <CheckCircleIcon />,
    description: '回答已生成',
  },
  error: {
    title: '异常',
    icon: <ErrorCircleIcon />,
    description: '运行出错',
  },
}

function getCurrentStepIndex(phases: RunState['phases']): number {
  for (let i = phases.length - 1; i >= 0; i--) {
    if (phases[i].status !== 'wait') {
      return phases[i].status === 'finish' || phases[i].status === 'error'
        ? i + 1
        : i
    }
  }
  return 0
}

export const ActivityPanel: React.FC<ActivityPanelProps> = ({
  runState,
  collapsed = false,
}) => {
  const currentStep = useMemo(() => {
    if (!runState) return 0
    return getCurrentStepIndex(runState.phases)
  }, [runState])

  const progressPercent = useMemo(() => {
    if (!runState) return 0
    const total = runState.phases.length
    const finished = runState.phases.filter(
      (p) => p.status === 'finish' || p.status === 'error',
    ).length
    const inProgress = runState.phases.filter(
      (p) => p.status === 'process',
    ).length
    return Math.round(((finished + inProgress * 0.5) / total) * 100)
  }, [runState])

  if (!runState) {
    return (
      <div className="activity-panel activity-panel-empty">
        <Tag theme="default" variant="light" size="small">
          等待开始
        </Tag>
      </div>
    )
  }

  if (collapsed) {
    return (
      <div className="activity-panel activity-panel-collapsed">
        <Progress
          percentage={progressPercent}
          size="small"
          label={false}
        />
        <span className="activity-panel-phase-label">
          {PHASE_CONFIG[runState.currentPhase]?.title || '运行中'}
        </span>
        {runState.currentIteration > 0 && (
          <Tag size="small" variant="light" theme="primary">
            第 {runState.currentIteration}/{runState.maxIterations} 轮
          </Tag>
        )}
      </div>
    )
  }

  return (
    <div className="activity-panel">
      <div className="activity-panel-header">
        <span className="activity-panel-title">Agent 执行流程</span>
        <Progress
          percentage={progressPercent}
          size="small"
          label={false}
          style={{ width: 80, flexShrink: 0 }}
        />
      </div>

      <Steps
        current={currentStep}
        layout="vertical"
        theme="dot"
        className="activity-panel-steps"
      >
        {runState.phases.map((phaseInfo) => {
          const config = PHASE_CONFIG[phaseInfo.phase]
          const stepStatus =
            phaseInfo.status === 'error'
              ? 'error'
              : phaseInfo.status === 'finish'
                ? 'finish'
                : phaseInfo.status === 'process'
                  ? 'process'
                  : 'default'

          return (
            <Steps.StepItem
              key={phaseInfo.phase}
              status={stepStatus}
              title={
                <div className="activity-step-title">
                  {config.icon}
                  <span>{config.title}</span>
                  {phaseInfo.status === 'process' && (
                    <Tag size="small" variant="light" theme="warning">
                      进行中
                    </Tag>
                  )}
                  {phaseInfo.status === 'finish' && phaseInfo.endTime && phaseInfo.startTime && (
                    <Tag size="small" variant="light" theme="success">
                      {((phaseInfo.endTime - phaseInfo.startTime) / 1000).toFixed(1)}s
                    </Tag>
                  )}
                </div>
              }
              content={
                phaseInfo.status !== 'wait' ? config.description : undefined
              }
            />
          )
        })}
      </Steps>

      {runState.currentIteration > 0 && (
        <div className="activity-panel-iteration">
          <Tag theme="primary" variant="light" size="small">
            推理迭代: {runState.currentIteration}/{runState.maxIterations}
          </Tag>
          {runState.toolCallCount > 0 && (
            <Tag theme="warning" variant="light" size="small">
              工具调用: {runState.toolCallCount} 次
            </Tag>
          )}
        </div>
      )}
    </div>
  )
}

export default ActivityPanel