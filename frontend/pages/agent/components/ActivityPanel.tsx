import React, { useMemo } from 'react'
import { Tag } from 'tdesign-react'
import { CheckCircleFilledIcon, TimeIcon } from 'tdesign-icons-react'
import type { RunState, RunPhase } from '../hooks/useAgentRun'

interface ActivityPanelProps {
  runState: RunState | null
  collapsed?: boolean
}

const PHASE_CONFIG: Record<
  RunPhase,
  { title: string; description: string }
> = {
  idle: {
    title: '等待',
    description: '等待用户输入',
  },
  perception: {
    title: '解析目的地信息',
    description: '了解北京的景点、交通和天气',
  },
  memory: {
    title: '查找过往旅行记录',
    description: '检索相关上下文',
  },
  thinking: {
    title: '规划每日行程',
    description: '分析问题并推理',
  },
  tool_calling: {
    title: '调用工具',
    description: '执行外部工具调用',
  },
  generating: {
    title: '生成回答',
    description: '生成最终回复',
  },
  done: {
    title: '完成',
    description: '回答已生成',
  },
  error: {
    title: '异常',
    description: '运行出错',
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
    ? { theme: 'default' as const, text: '待开始' }
    : isAllDone
      ? { theme: 'success' as const, text: '已完成' }
      : runState.currentPhase === 'error'
        ? { theme: 'danger' as const, text: '失败' }
        : { theme: 'primary' as const, text: '进行中' }

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
      {/* 头部：标题 + 状态标签 */}
      <div className="activity-panel-header">
        <div className="activity-panel-header-title-group">
          <span className="activity-panel-title">Agent 执行流程</span>
          <span className="activity-panel-meta">
            {progress.finished}/{progress.total} 步骤
          </span>
        </div>
        <Tag theme={statusTag.theme} variant="light" size="small">
          {statusTag.text}
        </Tag>
      </div>

      {/* 进度条 */}
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

      {/* 步骤列表 */}
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
            <TimeIcon /> 推理迭代 {runState.currentIteration}/
            {runState.maxIterations} · 工具调用 {runState.toolCallCount} 次
          </span>
        </div>
      )}
    </div>
  )
}

export default ActivityPanel