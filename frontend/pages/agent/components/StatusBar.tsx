import React from 'react'
import { Tag } from 'tdesign-react'
import type { ChatMessage } from '../types'
import { getToolCallCount, getCurrentPhase } from '../types'

const PHASE_LABEL: Record<string, { label: string; theme: 'default' | 'primary' | 'warning' | 'success' | 'danger' }> = {
  idle: { label: '空闲', theme: 'default' },
  thinking: { label: '思考中', theme: 'warning' },
  tool_call: { label: '调用工具', theme: 'warning' },
  tool_result: { label: '接收结果', theme: 'primary' },
  text_stream: { label: '生成回答', theme: 'primary' },
  error: { label: '异常', theme: 'danger' },
  success: { label: '已完成', theme: 'success' },
}

interface StatusBarProps {
  message: ChatMessage | null
  isGenerating: boolean
}

export const StatusBar: React.FC<StatusBarProps> = ({ message, isGenerating }) => {
  if (!message) {
    return (
      <div className="status-bar">
        <Tag theme="default" variant="light" size="small">
          空闲
        </Tag>
        <span className="status-text">等待开始</span>
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
        {isGenerating ? phaseInfo.label : message.status === 'error' ? '异常' : message.status === 'loading' ? '生成中' : '已完成'}
      </Tag>
      {toolCount > 0 && (
        <span className="status-text">
          工具调用: {toolCount} 次
        </span>
      )}
      <span className="status-text">
        步骤数: {stepCount}
      </span>
      {message.status === 'loading' && isGenerating && (
        <span className="status-text status-text-pulse">
          Agent 正在推理...
        </span>
      )}
    </div>
  )
}

export default StatusBar
