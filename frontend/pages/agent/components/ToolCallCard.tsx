import React, { useState } from 'react'
import { Tag, Loading, Space } from 'tdesign-react'
import {
  CheckCircleIcon,
  CloseCircleIcon,
  ToolsIcon,
  ArrowDownIcon,
} from 'tdesign-icons-react'
import type { ToolCall } from '../types'

interface ToolCallCardProps {
  toolCall: ToolCall
}

const STATUS_CONFIG: Record<
  ToolCall['status'],
  { theme: 'warning' | 'success' | 'danger' | 'default'; label: string }
> = {
  pending: { theme: 'default', label: '等待中' },
  running: { theme: 'warning', label: '执行中' },
  success: { theme: 'success', label: '已完成' },
  error: { theme: 'danger', label: '失败' },
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(
    toolCall.status === 'running' || toolCall.status === 'pending',
  )
  const statusCfg = STATUS_CONFIG[toolCall.status]

  return (
    <div className="agent-tool-call-item">
      <div
        className="agent-tool-call-header"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Space size="small" align="center">
          {toolCall.status === 'running' ? (
            <Loading size="small" />
          ) : toolCall.status === 'success' ? (
            <CheckCircleIcon style={{ color: 'var(--td-success-color)' }} />
          ) : toolCall.status === 'error' ? (
            <CloseCircleIcon style={{ color: 'var(--td-error-color)' }} />
          ) : (
            <ToolsIcon style={{ color: 'var(--td-text-color-placeholder)' }} />
          )}
          <Tag theme={statusCfg.theme} variant="light" size="small">
            {statusCfg.label}
          </Tag>
          <span className="agent-tool-call-name">{toolCall.name}</span>
        </Space>
        <ArrowDownIcon
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
            color: 'var(--td-text-color-placeholder)',
            fontSize: 16,
          }}
        />
      </div>

      {expanded && (
        <div className="agent-tool-call-body">
          <div className="agent-tool-call-section">
            <div className="agent-tool-call-label">调用参数</div>
            <pre className="agent-tool-call-code">
              {formatJson(toolCall.arguments)}
            </pre>
          </div>
          {toolCall.result && (
            <div className="agent-tool-call-section">
              <div className="agent-tool-call-label">返回结果</div>
              <pre className="agent-tool-call-code">
                {formatJson(toolCall.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}