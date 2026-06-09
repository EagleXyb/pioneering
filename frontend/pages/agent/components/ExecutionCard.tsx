import React from 'react'
import { ActivityPanel } from './ActivityPanel'
import { StatusBar } from './StatusBar'
import type { RunState } from '../hooks/useAgentRun'
import type { ChatMessage } from '../types'

interface ExecutionCardProps {
  runState: RunState | null
  message: ChatMessage | null
  isGenerating: boolean
}

export const ExecutionCard: React.FC<ExecutionCardProps> = ({ runState, message, isGenerating }) => {
  if (!runState) return null

  return (
    <div className="agent-execution-card">
      <div className="agent-execution-card-header">
        <span className="agent-execution-card-title">Agent 执行过程</span>
      </div>
      <ActivityPanel runState={runState} />
      <div className="agent-execution-card-footer">
        <StatusBar message={message} isGenerating={isGenerating} runState={runState} />
      </div>
    </div>
  )
}

export default ExecutionCard
