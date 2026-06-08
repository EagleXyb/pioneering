import React from 'react'
import { Button, Divider, Tooltip } from 'tdesign-react'
import { ArrowLeftIcon, SettingIcon, DownloadIcon, RefreshIcon, DeleteIcon } from 'tdesign-icons-react'
import { useNavigate } from 'react-router-dom'
import type { ChatMessage } from '../../types'
import { StatusBar } from './StatusBar'
import type { RunState } from '../../hooks/useAgentRun'

interface ChatHeaderProps {
  currentSessionId: string | null
  lastAssistantMessage: ChatMessage | null
  isGenerating: boolean
  runState: RunState | null
  onOpenParams: () => void
  onExport: () => void
  onRegenerate: () => void
  onClear: () => void
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  currentSessionId,
  lastAssistantMessage,
  isGenerating,
  runState,
  onOpenParams,
  onExport,
  onRegenerate,
  onClear,
}) => {
  const navigate = useNavigate()

  return (
    <div className="agent-header">
      <div className="agent-header-left">
        <Button
          theme="default"
          variant="text"
          shape="square"
          icon={<ArrowLeftIcon />}
          onClick={() => navigate(-1)}
        />
        <Divider layout="vertical" />
        <span className="agent-header-title">AI 智能对话</span>
        {currentSessionId && (
          <span className="agent-header-session-id">
            会话: {currentSessionId.slice(0, 12)}...
          </span>
        )}
      </div>
      <div className="agent-header-right">
        <StatusBar message={lastAssistantMessage} isGenerating={isGenerating} runState={runState} />
        <Tooltip content="参数配置">
          <Button theme="default" variant="text" size="small" icon={<SettingIcon />} onClick={onOpenParams} />
        </Tooltip>
        <Tooltip content="导出对话">
          <Button theme="default" variant="text" size="small" icon={<DownloadIcon />} onClick={onExport} />
        </Tooltip>
        <Tooltip content="重新生成">
          <Button theme="default" variant="text" size="small" icon={<RefreshIcon />} onClick={onRegenerate} />
        </Tooltip>
        <Tooltip content="清空对话">
          <Button theme="default" variant="text" size="small" icon={<DeleteIcon />} onClick={onClear} />
        </Tooltip>
      </div>
    </div>
  )
}
