import React, { useState } from 'react'
import { Button, Tooltip, Tag, Empty } from 'tdesign-react'
import {
  FlashlightIcon,
  FileCopyIcon,
  DownloadIcon,
  FullscreenIcon,
  MinusIcon,
} from 'tdesign-icons-react'
import { ActivityPanel } from './ActivityPanel'
import type { RunState } from '../hooks/useAgentRun'

interface ExecutionPanelProps {
  runState: RunState | null
}

export const ExecutionPanel: React.FC<ExecutionPanelProps> = ({ runState }) => {
  const [collapsed, setCollapsed] = useState(false)

  const handleCopy = () => {
    if (!runState) return
    const summary = [
      `Run ID: ${runState.runId}`,
      `当前阶段: ${runState.currentPhase}`,
      `迭代: ${runState.currentIteration}/${runState.maxIterations}`,
      `工具调用: ${runState.toolCallCount}`,
      runState.error ? `错误: ${runState.error}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    navigator.clipboard?.writeText(summary).catch(() => undefined)
  }

  const handleDownload = () => {
    if (!runState) return
    const log = runState.phases
      .map(
        (p) =>
          `[${p.status.toUpperCase()}] ${p.phase}${
            p.startTime ? ` @ ${new Date(p.startTime).toLocaleTimeString()}` : ''
          }`,
      )
      .join('\n')
    const blob = new Blob([`# Agent 执行过程\n\n${log}\n`], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agent-run-${runState.runId}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (collapsed) {
    return (
      <aside className="agent-execution-panel agent-execution-panel-collapsed">
        <div className="agent-execution-collapsed-stack">
          <Tooltip content="展开执行过程面板" placement="left">
            <Button
              theme="default"
              variant="text"
              shape="square"
              icon={<FlashlightIcon style={{ color: 'var(--ag-accent, #7c3aed)' }} />}
              onClick={() => setCollapsed(false)}
            />
          </Tooltip>
          <ActivityPanel runState={runState} collapsed />
        </div>
      </aside>
    )
  }

  return (
    <aside className="agent-execution-panel">
      <header className="agent-execution-panel-header">
        <div className="agent-execution-panel-title">
          <FlashlightIcon style={{ color: 'var(--ag-accent, #7c3aed)' }} />
          <span>研究过程</span>
          {runState?.isRunning && (
            <Tag size="small" theme="primary" variant="light">
              运行中
            </Tag>
          )}
        </div>
        <div className="agent-execution-panel-actions">
          <Tooltip content="复制执行摘要" placement="bottom">
            <Button
              theme="default"
              variant="text"
              shape="square"
              size="small"
              icon={<FileCopyIcon />}
              onClick={handleCopy}
              disabled={!runState}
            />
          </Tooltip>
          <Tooltip content="下载执行日志" placement="bottom">
            <Button
              theme="default"
              variant="text"
              shape="square"
              size="small"
              icon={<DownloadIcon />}
              onClick={handleDownload}
              disabled={!runState}
            />
          </Tooltip>
          <Tooltip content="全屏查看" placement="bottom">
            <Button
              theme="default"
              variant="text"
              shape="square"
              size="small"
              icon={<FullscreenIcon />}
            />
          </Tooltip>
          <Tooltip content="收起面板" placement="bottom">
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

      <div className="agent-execution-panel-body">
        {runState ? (
          <ActivityPanel runState={runState} />
        ) : (
          <div className="agent-execution-panel-empty">
            <Empty
              description="暂无执行过程,发起对话后将展示 Agent 的执行步骤"
              size="small"
            />
          </div>
        )}
      </div>
    </aside>
  )
}

export default ExecutionPanel
