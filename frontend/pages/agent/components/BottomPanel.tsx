import React from 'react'
import { Button, Switch, Tooltip, Space, Divider } from 'tdesign-react'
import { SettingIcon, RefreshIcon, DeleteIcon, DownloadIcon } from 'tdesign-icons-react'
import { StatusBar } from './StatusBar'
import type { ChatMessage } from '../types'
import type { RunState } from '../hooks/useAgentRun'

interface BottomPanelProps {
  lastMessage: ChatMessage | null
  isGenerating: boolean
  runState?: RunState | null
  deepThinking: boolean
  webSearch: boolean
  onDeepThinkingChange: (v: boolean) => void
  onWebSearchChange: (v: boolean) => void
  onOpenParams: () => void
  onClear: () => void
  onRegenerate: () => void
  onExport: () => void
}

export const BottomPanel: React.FC<BottomPanelProps> = ({
  lastMessage,
  isGenerating,
  runState,
  deepThinking,
  webSearch,
  onDeepThinkingChange,
  onWebSearchChange,
  onOpenParams,
  onClear,
  onRegenerate,
  onExport,
}) => {
  return (
    <div className="bottom-panel">
      <div className="bottom-panel-top">
        <Space size="small">
          <Tooltip content="开启后,Agent 会先输出思考过程再回答,准确度更高但速度更慢">
            <div className="bottom-switch-item">
              <span className="bottom-switch-label">深度思考</span>
              <Switch
                size="small"
                value={deepThinking}
                onChange={onDeepThinkingChange}
                disabled={isGenerating}
              />
            </div>
          </Tooltip>

          <Tooltip content="Agent 可调用搜索工具获取实时信息">
            <div className="bottom-switch-item">
              <span className="bottom-switch-label">联网搜索</span>
              <Switch
                size="small"
                value={webSearch}
                onChange={onWebSearchChange}
                disabled={isGenerating}
              />
            </div>
          </Tooltip>
        </Space>

        <div className="bottom-panel-actions">
          <StatusBar message={lastMessage} isGenerating={isGenerating} runState={runState} />
          <Divider layout="vertical" />
          <Tooltip content="参数配置">
            <Button
              theme="default"
              variant="text"
              size="small"
              icon={<SettingIcon />}
              onClick={onOpenParams}
            />
          </Tooltip>
          <Tooltip content="导出对话">
            <Button
              theme="default"
              variant="text"
              size="small"
              icon={<DownloadIcon />}
              onClick={onExport}
            />
          </Tooltip>
          <Tooltip content="重新生成">
            <Button
              theme="default"
              variant="text"
              size="small"
              icon={<RefreshIcon />}
              onClick={onRegenerate}
            />
          </Tooltip>
          <Tooltip content="清空对话">
            <Button
              theme="default"
              variant="text"
              size="small"
              icon={<DeleteIcon />}
              onClick={onClear}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

export default BottomPanel
